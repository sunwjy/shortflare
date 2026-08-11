import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createCloudflareApi } from "./cloudflare-api.js";
import { createCloudflareDeploymentExecutor } from "./cloudflare-deployment-executor.js";
import { observeCloudflareDeployment } from "./cloudflare-observer.js";
import { createD1DeploymentJournal } from "./d1-deployment-journal.js";
import { createDeploymentApplication } from "./deployment-application.js";
import type { DeploymentPlan } from "./deployment-plan.js";
import { resolveShortflarePaths, writeInstanceConfig } from "./local-instance-config.js";
import { createNodeWranglerRun } from "./node-wrangler-runner.js";
import { createProductionRecovery } from "./production-recovery.js";
import { verifyReleaseBundle } from "./release-bundle.js";
import { parseReleaseManifest } from "./release-manifest.js";
import { createWranglerAdapter } from "./wrangler-adapter.js";

export async function createProductionApplication(
  input: Readonly<{
    packageRoot: string;
    apiToken: string;
    environment: Readonly<Record<string, string | undefined>>;
    platform: NodeJS.Platform;
    homeDirectory: string;
    promptApproval(plan: DeploymentPlan): Promise<boolean>;
    promptAdministratorEmail?(): Promise<string | undefined>;
    fetch?: typeof globalThis.fetch;
    now?: () => Date;
    secretInput?: string;
  }>,
) {
  const manifestInput: unknown = JSON.parse(
    await readFile(path.join(input.packageRoot, "release", "manifest.json"), "utf8"),
  );
  const parsedManifest = parseReleaseManifest(manifestInput);
  if (!parsedManifest.ok) throw new Error("Bundled release manifest is invalid");
  const manifest = parsedManifest.value;
  const integrity = await verifyReleaseBundle(input.packageRoot, manifest);
  if (!integrity.ok) throw new Error(`Bundled ${integrity.artifact} artifact failed verification`);

  const fetchImplementation = input.fetch ?? globalThis.fetch;
  const now = input.now ?? (() => new Date());
  const api = createCloudflareApi({ apiToken: input.apiToken, fetch: fetchImplementation });
  const wranglerForAccount = (accountId: string) =>
    createWranglerAdapter({
      run: createNodeWranglerRun({
        environment: {
          CLOUDFLARE_ACCOUNT_ID: accountId,
          CLOUDFLARE_API_TOKEN: input.apiToken,
        },
      }),
    });
  const recover = createProductionRecovery({
    api,
    manifest,
    now,
    wranglerForAccount,
    ...(input.secretInput === undefined ? {} : { secretInput: input.secretInput }),
  });

  return createDeploymentApplication({
    manifest,
    observe: async (accountId, domains) =>
      observeCloudflareDeployment({
        api,
        accountId,
        targetMigrations: manifest.schema.migrations,
        targetRelease: manifest.release,
        managementArtifactSha256: manifest.artifacts.management.sha256,
        redirectArtifactSha256: manifest.artifacts.redirect.sha256,
        migrationJournalSha256: manifest.schema.journalSha256,
        ...(domains?.redirectDomain === undefined
          ? {}
          : { redirectDomain: domains.redirectDomain }),
        ...(domains?.managementDomain === undefined
          ? {}
          : { managementDomain: domains.managementDomain }),
      }),
    createExecutor(observed, request) {
      const existing = observed.kind === "present" ? observed : undefined;
      const paths = resolveShortflarePaths({
        platform: input.platform,
        homeDirectory: input.homeDirectory,
        environment: input.environment,
        accountId: observed.accountId,
        ...(request.backupDirectory === undefined
          ? {}
          : { backupOverride: request.backupDirectory }),
      });
      return createCloudflareDeploymentExecutor({
        api,
        wrangler: wranglerForAccount(observed.accountId),
        accountId: observed.accountId,
        ...(existing?.databaseId === undefined ? {} : { existingDatabaseId: existing.databaseId }),
        ...(existing === undefined ? {} : { existingInstanceId: existing.instanceId }),
        ...(existing?.coherentWorkerVersions === undefined
          ? {}
          : { previousWorkerVersions: existing.coherentWorkerVersions }),
        releaseRoot: path.join(input.packageRoot, "release"),
        temporaryRoot: path.join(os.tmpdir(), `shortflare-${randomUUID()}`),
        backupDirectory: paths.backupDirectory,
        redirectDomain: request.redirectDomain,
        ...(request.managementDomain === undefined
          ? {}
          : { managementDomain: request.managementDomain }),
        manifest,
        ...(request.setupTokenFromStdin && input.secretInput !== undefined
          ? { setupToken: input.secretInput }
          : {}),
        now,
        randomBytes,
        randomId: randomUUID,
        fetch: fetchImplementation,
        delay: (milliseconds) =>
          new Promise((resolve) => {
            setTimeout(resolve, milliseconds);
          }),
      });
    },
    createJournal(databaseId, accountId) {
      return createD1DeploymentJournal({
        query: async (sql, parameters) => {
          const result = await api.queryD1(accountId, databaseId, sql, parameters);
          if (!result.ok) throw new Error(`Deployment journal failed with ${result.kind}`);
          return result.rows;
        },
        now,
        randomId: randomUUID,
      });
    },
    async writeConfig(result) {
      if (result.instanceId === undefined) throw new Error("Instance marker was not resolved");
      const paths = resolveShortflarePaths({
        platform: input.platform,
        homeDirectory: input.homeDirectory,
        environment: input.environment,
        accountId: result.accountId,
      });
      await writeInstanceConfig(paths.configFile, {
        formatVersion: 1,
        accountId: result.accountId,
        instanceId: result.instanceId,
        databaseId: result.databaseId,
        redirectDomain: result.redirectDomain,
        ...(result.managementDomain === undefined
          ? {}
          : { managementDomain: result.managementDomain }),
        coherentRelease: result.release,
      });
    },
    approvePlan: input.promptApproval,
    ...(input.promptAdministratorEmail === undefined
      ? {}
      : { requestAdministratorEmail: input.promptAdministratorEmail }),
    diagnose: async (accountId) => {
      const observed = await observeCloudflareDeployment({
        api,
        accountId,
        targetMigrations: manifest.schema.migrations,
      });
      return { ok: true, formatVersion: 1, observed };
    },
    recover,
  });
}
