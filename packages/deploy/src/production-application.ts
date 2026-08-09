import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { CliApplicationResult } from "./cli.js";
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
import { createRecoveryPlan } from "./recovery-plan.js";
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
  async function withRecoveryLease(
    accountId: string,
    databaseId: string,
    plan: DeploymentPlan,
    effect: () => Promise<CliApplicationResult>,
  ): Promise<CliApplicationResult> {
    const journal = createD1DeploymentJournal({
      query: async (sql, parameters) => {
        const result = await api.queryD1(accountId, databaseId, sql, parameters);
        if (!result.ok) throw new Error(`Recovery journal failed with ${result.kind}`);
        return result.rows;
      },
      now,
      randomId: randomUUID,
    });
    const attempt = await journal.begin(plan);
    const lease = await journal.revalidateAndRenewLease(attempt.attemptId, attempt.fencingToken);
    if (!lease.ok) throw new Error("Recovery Deployment Lease was lost");
    const latest = await observeCloudflareDeployment({
      api,
      accountId,
      targetMigrations: manifest.schema.migrations,
    });
    const latestDigest = createHash("sha256").update(JSON.stringify(latest)).digest("hex");
    if (latestDigest !== plan.targetManifestDigest) {
      await journal.fail(attempt.attemptId, {
        kind: "deployment-drift",
        stage: "recover",
        retryable: false,
        recovery: "regenerate-plan",
      });
      return recoveryRefused("Recovery target changed after approval; generate a new plan");
    }
    try {
      const result = await effect();
      if (!result.ok) {
        await journal.fail(attempt.attemptId, {
          kind: "deployment-drift",
          stage: "recover",
          retryable: false,
          recovery: "regenerate-plan",
        });
        return result;
      }
      await journal.recordActionCompleted(attempt.attemptId, 0);
      await journal.complete(attempt.attemptId);
      return result;
    } catch (error: unknown) {
      await journal.fail(attempt.attemptId, {
        kind: "cloudflare-transient",
        stage: "recover",
        retryable: true,
        recovery: "rerun-deploy",
      });
      throw error;
    }
  }
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
        ...(domains?.redirectDomain === undefined
          ? {}
          : { redirectDomain: domains.redirectDomain }),
        ...(domains?.managementDomain === undefined
          ? {}
          : { managementDomain: domains.managementDomain }),
      }),
    createExecutor(observed, request) {
      const existing = observed.kind === "present" ? observed : undefined;
      const wrangler = wranglerForAccount(observed.accountId, input.apiToken);
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
        targetMigrations: manifest.schema.migrations,
      });
      return { ok: true, formatVersion: 1, observed };
    },
    recover: async (accountId, command) => {
      try {
        const wrangler = wranglerForAccount(accountId, input.apiToken);
        const observed = await observeCloudflareDeployment({
          api,
          accountId,
          targetMigrations: manifest.schema.migrations,
        });
        const recoveryPlan = createRecoveryPlan(
          accountId,
          observed.kind === "present" ? observed.coherentRelease : "fresh",
          command,
          observed,
        );
        if (command.approval.kind === "none") {
          return { ok: true, formatVersion: 1, finalState: "planned", plan: recoveryPlan };
        }
        if (command.approval.digest !== recoveryPlan.digest) {
          return {
            ok: false,
            exitCode: 4,
            error: {
              kind: "approval-required",
              message: `Approve recovery plan ${recoveryPlan.digest} with --approve-digest`,
            },
          };
        }
        if (command.action === "orphan-resources") {
          if (observed.kind !== "absent" || command.resource === undefined) {
            return recoveryRefused("The target is not a diagnosed Orphan Resource");
          }
          const collision = orphanCollision(command.resource);
          if (collision === undefined || !observed.collisions.includes(collision)) {
            return recoveryRefused(`Diagnosis did not report '${command.resource}' as orphaned`);
          }
          if (
            command.resource === "primary-queue" &&
            observed.collisions.some(
              (item) =>
                item === "worker:shortflare-management" ||
                item.startsWith("consumer:shortflare-events:"),
            )
          ) {
            return recoveryRefused(
              "Delete the orphaned Management Worker consumer before the primary Queue",
            );
          }
          if (
            command.resource === "management-worker" &&
            observed.collisions.some((item) => item.startsWith("consumer:shortflare-events:"))
          ) {
            return recoveryRefused("Delete the orphaned Queue consumer before its Worker");
          }
          if (command.resource === "d1" && observed.collisions.some((item) => item !== collision)) {
            return recoveryRefused("Delete orphaned Workers and Queues before D1");
          }
          if (command.resource.startsWith("consumer:")) {
            const [, queueName, consumerId] = command.resource.split(":");
            const queues = await api.listQueues(accountId);
            if (!queues.ok) return recoveryRefused(`Queue lookup failed with ${queues.kind}`);
            const queue = queues.queues.find((candidate) => candidate.name === queueName);
            if (queue === undefined || consumerId === undefined) {
              return recoveryRefused("Orphan Queue consumer is no longer present");
            }
            const deleted = await api.deleteQueueConsumer(accountId, queue.id, consumerId);
            if (!deleted.ok)
              return recoveryRefused(`Consumer deletion failed with ${deleted.kind}`);
          } else if (command.resource.startsWith("domain:")) {
            const hostname = command.resource.slice("domain:".length);
            const listed = await api.listWorkerDomains(accountId);
            if (!listed.ok) return recoveryRefused(`Domain lookup failed with ${listed.kind}`);
            const domain = listed.domains.find((candidate) => candidate.hostname === hostname);
            if (domain === undefined) return recoveryRefused("Orphan domain is no longer present");
            const deleted = await api.deleteWorkerDomain(accountId, domain.id);
            if (!deleted.ok) return recoveryRefused(`Domain deletion failed with ${deleted.kind}`);
          } else {
            await deleteOrphan(command.resource, wrangler);
          }
          return { ok: true, formatVersion: 1, action: command.action, resource: command.resource };
        }
        if (observed.kind !== "present" || observed.databaseId === undefined) {
          return recoveryRefused("Recovery requires a marked Shortflare Instance");
        }
        const databaseId = observed.databaseId;
        if (command.action === "analytics-secret") {
          const analyticsSecret =
            command.secretFromStdin && input.secretInput !== undefined
              ? input.secretInput
              : randomBytes(32).toString("base64url");
          return withRecoveryLease(accountId, databaseId, recoveryPlan, async () => {
            await wrangler.putSecret("shortflare-redirect", "ANALYTICS_HMAC_KEY", analyticsSecret);
            return {
              ok: true,
              formatVersion: 1,
              action: command.action,
              warning: "Visitor uniqueness may be discontinuous across analytics secret rotation",
            };
          });
        }
        if (command.action === "worker-rollback") {
          if (command.worker === undefined || command.versionTag === undefined) {
            return recoveryRefused("Worker rollback target is incomplete");
          }
          const versionTag = command.versionTag;
          const worker = command.worker;
          const rollbackRelease = versionTag.endsWith(`-${worker}`)
            ? versionTag.slice(0, -`-${worker}`.length)
            : "";
          if (
            !manifest.rollbackSafeFrom.includes(rollbackRelease) ||
            observed.schemaVersion !== manifest.schema.version
          ) {
            return recoveryRefused(
              "Release manifest or live schema does not declare this rollback safe",
            );
          }
          return withRecoveryLease(accountId, databaseId, recoveryPlan, async () => {
            const workerName =
              worker === "management" ? "shortflare-management" : "shortflare-redirect";
            const versionId = await wrangler.resolveVersionIdByName(workerName, versionTag);
            await wrangler.activateWorkerTag(workerName, versionTag);
            const activated = await api.listActiveWorkerVersions(accountId, workerName);
            if (!activated.ok || !activated.versionIds.includes(versionId)) {
              return recoveryRefused("Rollback Worker version failed live verification");
            }
            return { ok: true, formatVersion: 1, action: command.action, worker };
          });
        }
        if (command.administratorEmail === undefined) {
          return recoveryRefused("Administrator email is required");
        }
        const administratorEmail = command.administratorEmail;
        return withRecoveryLease(accountId, databaseId, recoveryPlan, async () => {
          const eligibility = await api.queryD1(
            accountId,
            databaseId,
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
            databaseId,
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
              administratorEmail,
              administratorEmail.trim().toLowerCase(),
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
        });
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

function wranglerForAccount(accountId: string, apiToken: string) {
  return createWranglerAdapter({
    run: createNodeWranglerRun({
      environment: {
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: apiToken,
      },
    }),
  });
}

function recoveryRefused(message: string) {
  return { ok: false, exitCode: 3, error: { kind: "recovery-refused", message } } as const;
}

function orphanCollision(resource: string): string | undefined {
  if (resource.startsWith("consumer:shortflare-events:")) return resource;
  if (resource.startsWith("domain:")) return resource;
  if (resource === "d1") return "d1:shortflare";
  if (resource === "primary-queue") return "queue:shortflare-events";
  if (resource === "dead-letter-queue") return "queue:shortflare-events-dlq";
  if (resource === "management-worker") return "worker:shortflare-management";
  if (resource === "redirect-worker") return "worker:shortflare-redirect";
  return undefined;
}

async function deleteOrphan(
  resource: string,
  wrangler: ReturnType<typeof createWranglerAdapter>,
): Promise<void> {
  if (resource === "d1") return wrangler.deleteD1("shortflare");
  if (resource === "primary-queue") return wrangler.deleteQueue("shortflare-events");
  if (resource === "dead-letter-queue") return wrangler.deleteQueue("shortflare-events-dlq");
  if (resource === "management-worker") return wrangler.deleteWorker("shortflare-management");
  if (resource === "redirect-worker") return wrangler.deleteWorker("shortflare-redirect");
  throw new Error(`Unsupported Orphan Resource '${resource}'`);
}

function isSetupEligible(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const setupCompletedAt = Reflect.get(value, "setupCompletedAt");
  const activeAdministrators = Reflect.get(value, "activeAdministrators");
  return setupCompletedAt === null && activeAdministrators === 0;
}
