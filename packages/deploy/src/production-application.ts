import { createHash, randomBytes, randomUUID } from "node:crypto";
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
  const integrity = await verifyReleaseBundle(input.packageRoot, parsedManifest.value);
  if (!integrity.ok) throw new Error(`Bundled ${integrity.artifact} artifact failed verification`);

  const fetchImplementation = input.fetch ?? globalThis.fetch;
  const now = input.now ?? (() => new Date());
  const api = createCloudflareApi({ apiToken: input.apiToken, fetch: fetchImplementation });
  return createDeploymentApplication({
    manifest: parsedManifest.value,
    observe: async (accountId) =>
      observeCloudflareDeployment({
        api,
        accountId,
        targetMigrations: parsedManifest.value.schema.migrations,
      }),
    createExecutor(observed, request) {
      const existing = observed.kind === "present" ? observed : undefined;
      const wrangler = wranglerForAccount(observed.accountId);
      const paths = resolveShortflarePaths({
        platform: input.platform,
        homeDirectory: input.homeDirectory,
        environment: input.environment,
        accountId: observed.accountId,
        ...(request.backupDirectory === undefined
          ? {}
          : { backupOverride: request.backupDirectory }),
      });
      const executor = createCloudflareDeploymentExecutor({
        api,
        wrangler,
        accountId: observed.accountId,
        ...(existing?.databaseId === undefined ? {} : { existingDatabaseId: existing.databaseId }),
        ...(existing === undefined ? {} : { existingInstanceId: existing.instanceId }),
        releaseRoot: path.join(input.packageRoot, "release"),
        temporaryRoot: path.join(os.tmpdir(), `shortflare-${randomUUID()}`),
        backupDirectory: paths.backupDirectory,
        redirectDomain: request.redirectDomain,
        ...(request.managementDomain === undefined
          ? {}
          : { managementDomain: request.managementDomain }),
        manifest: parsedManifest.value,
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
      return executor;
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
        targetMigrations: parsedManifest.value.schema.migrations,
      });
      return { ok: true, formatVersion: 1, observed };
    },
    recover: async (accountId, command) => {
      try {
        const wrangler = wranglerForAccount(accountId);
        const observed = await observeCloudflareDeployment({
          api,
          accountId,
          targetMigrations: parsedManifest.value.schema.migrations,
        });
        if (command.action === "orphan-resources") {
          if (observed.kind !== "absent" || command.resource === undefined) {
            return recoveryRefused("The target is not a diagnosed Orphan Resource");
          }
          const collision = orphanCollision(command.resource);
          if (collision === undefined || !observed.collisions.includes(collision)) {
            return recoveryRefused(`Diagnosis did not report '${command.resource}' as orphaned`);
          }
          await deleteOrphan(command.resource, wrangler);
          return { ok: true, formatVersion: 1, action: command.action, resource: command.resource };
        }
        if (observed.kind !== "present" || observed.databaseId === undefined) {
          return recoveryRefused("Recovery requires a marked Shortflare Instance");
        }
        if (command.action === "analytics-secret") {
          const analyticsSecret =
            command.secretFromStdin && input.secretInput !== undefined
              ? input.secretInput
              : randomBytes(32).toString("base64url");
          await wrangler.putSecret("shortflare-redirect", "ANALYTICS_HMAC_KEY", analyticsSecret);
          return {
            ok: true,
            formatVersion: 1,
            action: command.action,
            warning: "Visitor uniqueness may be discontinuous across analytics secret rotation",
          };
        }
        if (command.action === "worker-rollback") {
          if (command.worker === undefined || command.versionTag === undefined) {
            return recoveryRefused("Worker rollback target is incomplete");
          }
          await wrangler.activateWorkerTag(
            command.worker === "management" ? "shortflare-management" : "shortflare-redirect",
            command.versionTag,
          );
          return { ok: true, formatVersion: 1, action: command.action, worker: command.worker };
        }
        if (command.administratorEmail === undefined) {
          return recoveryRefused("Administrator email is required");
        }
        const eligibility = await api.queryD1(
          accountId,
          observed.databaseId,
          `SELECT i.setup_completed_at AS setupCompletedAt,
                  COUNT(u.id) AS activeAdministrators
           FROM instances i
           LEFT JOIN users u ON u.state = 'active' AND u.role = 'administrator'
           WHERE i.singleton_key = 1
           GROUP BY i.singleton_key, i.setup_completed_at`,
        );
        if (!eligibility.ok) return recoveryRefused(`D1 query failed with ${eligibility.kind}`);
        const row = eligibility.rows[0];
        if (!isSetupEligible(row)) {
          return recoveryRefused("Initial setup was completed or an active Administrator exists");
        }
        const token =
          command.secretFromStdin && input.secretInput !== undefined
            ? input.secretInput
            : randomBytes(32).toString("base64url");
        const createdAt = now().getTime();
        const written = await api.queryD1(
          accountId,
          observed.databaseId,
          `INSERT INTO initial_setup
             (singleton_key, display_email, normalized_email, token_hash, created_at, expires_at)
           VALUES (1, ?, ?, ?, ?, ?)
           ON CONFLICT(singleton_key) DO UPDATE SET
             display_email = excluded.display_email,
             normalized_email = excluded.normalized_email,
             token_hash = excluded.token_hash,
             created_at = excluded.created_at,
             expires_at = excluded.expires_at`,
          [
            command.administratorEmail,
            command.administratorEmail.trim().toLowerCase(),
            createHash("sha256").update(token).digest("hex"),
            String(createdAt),
            String(createdAt + 30 * 60_000),
          ],
        );
        if (!written.ok) return recoveryRefused(`D1 query failed with ${written.kind}`);
        return {
          ok: true,
          formatVersion: 1,
          action: command.action,
          ...(command.secretFromStdin ? {} : { setupToken: token }),
        };
      } catch (error: unknown) {
        return {
          ok: false,
          exitCode: 5,
          error: {
            kind: "recovery-failure",
            message: error instanceof Error ? error.message : "Recovery failed unexpectedly",
          },
        };
      }
    },
  });
}

function wranglerForAccount(accountId: string) {
  return createWranglerAdapter({
    run: createNodeWranglerRun({
      environment: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId },
    }),
  });
}

function recoveryRefused(message: string) {
  return { ok: false, exitCode: 3, error: { kind: "recovery-refused", message } } as const;
}

function orphanCollision(resource: string): string | undefined {
  if (resource === "d1") return "d1:shortflare";
  if (resource === "primary-queue") return "queue:shortflare-events";
  if (resource === "dead-letter-queue") return "queue:shortflare-events-dlq";
  return undefined;
}

async function deleteOrphan(
  resource: string,
  wrangler: ReturnType<typeof createWranglerAdapter>,
): Promise<void> {
  if (resource === "d1") return wrangler.deleteD1("shortflare");
  if (resource === "primary-queue") return wrangler.deleteQueue("shortflare-events");
  if (resource === "dead-letter-queue") return wrangler.deleteQueue("shortflare-events-dlq");
  throw new Error(`Unsupported Orphan Resource '${resource}'`);
}

function isSetupEligible(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const setupCompletedAt = Reflect.get(value, "setupCompletedAt");
  const activeAdministrators = Reflect.get(value, "activeAdministrators");
  return setupCompletedAt === null && activeAdministrators === 0;
}
