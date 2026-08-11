import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { CliApplicationResult } from "./cli.js";
import type { RecoverCommand } from "./cli-contract.js";
import type { CloudflareApi, CloudflareApiFailure } from "./cloudflare-api.js";
import { CloudflareObservationError, observeCloudflareDeployment } from "./cloudflare-observer.js";
import { createD1DeploymentJournal } from "./d1-deployment-journal.js";
import type { DeploymentPlan } from "./deployment-plan.js";
import type { DeploymentFailure, DeploymentRecovery } from "./deployment-runner.js";
import { createRecoveryPlan } from "./recovery-plan.js";
import type { ReleaseManifest } from "./release-manifest.js";
import type { WranglerAdapter } from "./wrangler-adapter.js";

export function createProductionRecovery(
  input: Readonly<{
    api: CloudflareApi;
    manifest: ReleaseManifest;
    now: () => Date;
    secretInput?: string;
    wranglerForAccount(accountId: string): WranglerAdapter;
  }>,
) {
  return async (accountId: string, command: RecoverCommand): Promise<CliApplicationResult> => {
    try {
      const wrangler = input.wranglerForAccount(accountId);
      const observed = await observeCloudflareDeployment({
        api: input.api,
        accountId,
        targetMigrations: input.manifest.schema.migrations,
      });
      const recoveryPlan = createRecoveryPlan(
        accountId,
        observed.kind === "present" ? observed.coherentRelease : "fresh",
        command,
        observed,
        input.manifest,
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
        return recoverOrphan(accountId, command, observed, wrangler);
      }
      if (observed.kind !== "present" || observed.databaseId === undefined) {
        return recoveryRefused("Recovery requires a marked Shortflare Instance");
      }
      if (observed.schemaVersion !== input.manifest.schema.version) {
        return recoveryRefused("Resume deployment until the Deployment Control schema is current");
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
        return recoverWorker(accountId, databaseId, command, observed, recoveryPlan, wrangler);
      }
      return recoverSetup(accountId, databaseId, command, recoveryPlan);
    } catch (error: unknown) {
      if (error instanceof CloudflareObservationError) {
        return cloudflareFailureResult(error.failure, "observation");
      }
      if (error instanceof RecoveryCloudflareError) {
        return cloudflareFailureResult(error.failure, "recover");
      }
      return {
        ok: false,
        exitCode: 5,
        error: {
          kind: "recovery-failure",
          message: error instanceof Error ? error.message : "Recovery failed unexpectedly",
        },
      };
    }
  };

  async function withRecoveryLease(
    accountId: string,
    databaseId: string,
    plan: DeploymentPlan,
    effect: () => Promise<CliApplicationResult>,
  ): Promise<CliApplicationResult> {
    const journal = createD1DeploymentJournal({
      query: async (sql, parameters) => {
        const result = await input.api.queryD1(accountId, databaseId, sql, parameters);
        if (!result.ok) throw new RecoveryCloudflareError(result);
        return result.rows;
      },
      now: input.now,
      randomId: randomUUID,
    });
    const attempt = await journal.begin(plan);
    const lease = await journal.revalidateAndRenewLease(attempt.attemptId, attempt.fencingToken);
    if (!lease.ok) throw new Error("Recovery Deployment Lease was lost");
    const latest = await observeCloudflareDeployment({
      api: input.api,
      accountId,
      targetMigrations: input.manifest.schema.migrations,
    });
    const latestDigest = createHash("sha256").update(JSON.stringify(latest)).digest("hex");
    if (latestDigest !== plan.targetManifestDigest) {
      await journal.fail(attempt.attemptId, deploymentDriftFailure);
      return recoveryRefused("Recovery target changed after approval; generate a new plan");
    }
    try {
      const result = await effect();
      if (!result.ok) {
        await journal.fail(attempt.attemptId, journalFailureForResult(result));
        return result;
      }
      const recoveryAction = plan.actions[0];
      if (recoveryAction === undefined) throw new Error("Recovery plan has no action");
      await journal.recordActionCompleted(attempt.attemptId, 0, recoveryAction);
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

  async function recoverOrphan(
    accountId: string,
    command: RecoverCommand,
    observed: Awaited<ReturnType<typeof observeCloudflareDeployment>>,
    wrangler: WranglerAdapter,
  ): Promise<CliApplicationResult> {
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
          item === "worker:shortflare-management" || item.startsWith("consumer:shortflare-events:"),
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
      const queues = await input.api.listQueues(accountId);
      if (!queues.ok) return cloudflareFailureResult(queues, "orphan-queue-lookup");
      const queue = queues.queues.find((candidate) => candidate.name === queueName);
      if (queue === undefined || consumerId === undefined) {
        return recoveryRefused("Orphan Queue consumer is no longer present");
      }
      const deleted = await input.api.deleteQueueConsumer(accountId, queue.id, consumerId);
      if (!deleted.ok) return cloudflareFailureResult(deleted, "orphan-consumer-delete");
    } else if (command.resource.startsWith("domain:")) {
      const hostname = command.resource.slice("domain:".length);
      const listed = await input.api.listWorkerDomains(accountId);
      if (!listed.ok) return cloudflareFailureResult(listed, "orphan-domain-lookup");
      const domain = listed.domains.find((candidate) => candidate.hostname === hostname);
      if (domain === undefined) return recoveryRefused("Orphan domain is no longer present");
      const deleted = await input.api.deleteWorkerDomain(accountId, domain.id);
      if (!deleted.ok) return cloudflareFailureResult(deleted, "orphan-domain-delete");
    } else {
      await deleteOrphan(command.resource, wrangler);
    }
    return { ok: true, formatVersion: 1, action: command.action, resource: command.resource };
  }

  async function recoverWorker(
    accountId: string,
    databaseId: string,
    command: RecoverCommand,
    observed: Extract<Awaited<ReturnType<typeof observeCloudflareDeployment>>, { kind: "present" }>,
    plan: DeploymentPlan,
    wrangler: WranglerAdapter,
  ): Promise<CliApplicationResult> {
    if (command.worker === undefined || command.versionTag === undefined) {
      return recoveryRefused("Worker rollback target is incomplete");
    }
    const versionTag = command.versionTag;
    const worker = command.worker;
    const rollbackRelease = versionTag.endsWith(`-${worker}`)
      ? versionTag.slice(0, -`-${worker}`.length)
      : "";
    if (
      !input.manifest.rollbackSafeFrom.includes(rollbackRelease) ||
      observed.schemaVersion !== input.manifest.schema.version
    ) {
      return recoveryRefused("Release manifest or live schema does not declare this rollback safe");
    }
    const [managementBindings, redirectBindings] = await Promise.all([
      input.api.listWorkerBindings(accountId, "shortflare-management"),
      input.api.listWorkerBindings(accountId, "shortflare-redirect"),
    ]);
    const hasDatabase = (
      bindings: readonly { name: string; type: string; databaseId?: string }[],
    ) =>
      bindings.some(
        (binding) =>
          binding.name === "DB" && binding.type === "d1" && binding.databaseId === databaseId,
      );
    if (!managementBindings.ok) {
      return cloudflareFailureResult(managementBindings, "rollback-management-bindings");
    }
    if (!redirectBindings.ok) {
      return cloudflareFailureResult(redirectBindings, "rollback-redirect-bindings");
    }
    if (
      !hasDatabase(managementBindings.bindings) ||
      !hasDatabase(redirectBindings.bindings) ||
      !redirectBindings.bindings.some(
        (binding) =>
          binding.name === "ANALYTICS_QUEUE" &&
          binding.type === "queue" &&
          binding.queueName === "shortflare-events",
      )
    ) {
      return recoveryRefused("Live Worker bindings do not declare this rollback safe");
    }
    return withRecoveryLease(accountId, databaseId, plan, async () => {
      const workerName = worker === "management" ? "shortflare-management" : "shortflare-redirect";
      const versionId = await wrangler.resolveVersionIdByName(workerName, versionTag);
      await wrangler.activateWorkerTag(workerName, versionTag);
      const activated = await input.api.listActiveWorkerVersions(accountId, workerName);
      if (!activated.ok) return cloudflareFailureResult(activated, "rollback-version-verify");
      if (!activated.versionIds.includes(versionId)) {
        return recoveryRefused("Rollback Worker version failed live verification");
      }
      return { ok: true, formatVersion: 1, action: command.action, worker };
    });
  }

  async function recoverSetup(
    accountId: string,
    databaseId: string,
    command: RecoverCommand,
    plan: DeploymentPlan,
  ): Promise<CliApplicationResult> {
    if (command.administratorEmail === undefined) {
      return recoveryRefused("Administrator email is required");
    }
    const administratorEmail = command.administratorEmail;
    return withRecoveryLease(accountId, databaseId, plan, async () => {
      const eligibility = await input.api.queryD1(
        accountId,
        databaseId,
        `SELECT i.setup_completed_at AS setupCompletedAt,
                COUNT(u.id) AS activeAdministrators
         FROM instances i
         LEFT JOIN users u ON u.state = 'active' AND u.role = 'administrator'
         WHERE i.singleton_key = 1
         GROUP BY i.singleton_key, i.setup_completed_at`,
      );
      if (!eligibility.ok) return cloudflareFailureResult(eligibility, "setup-eligibility");
      if (!isSetupEligible(eligibility.rows[0])) {
        return recoveryRefused("Initial setup was completed or an active Administrator exists");
      }
      const token =
        command.secretFromStdin && input.secretInput !== undefined
          ? input.secretInput
          : randomBytes(32).toString("base64url");
      const createdAt = input.now().getTime();
      const written = await input.api.queryD1(
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
      if (!written.ok) return cloudflareFailureResult(written, "setup-write");
      return {
        ok: true,
        formatVersion: 1,
        action: command.action,
        ...(command.secretFromStdin ? {} : { setupToken: token }),
      };
    });
  }
}

const deploymentDriftFailure = {
  kind: "deployment-drift",
  stage: "recover",
  retryable: false,
  recovery: "regenerate-plan",
} as const;

function recoveryRefused(message: string) {
  return { ok: false, exitCode: 3, error: { kind: "recovery-refused", message } } as const;
}

function cloudflareFailureResult(failure: CloudflareApiFailure, failedStage: string) {
  const exitCode =
    failure.kind === "cloudflare-authentication"
      ? 6
      : failure.kind === "cloudflare-authorization"
        ? 7
        : failure.retryable
          ? 5
          : 3;
  return {
    ok: false,
    exitCode,
    error: {
      kind: failure.kind,
      failedStage,
      retryable: failure.retryable,
      recovery: "fix-cloudflare-access",
      ...(failure.resource === undefined ? {} : { resource: failure.resource }),
      ...(failure.requiredPermission === undefined
        ? {}
        : { requiredPermission: failure.requiredPermission }),
    },
  } as const;
}

function journalFailureForResult(result: CliApplicationResult): DeploymentFailure {
  const error = result.error;
  if (typeof error !== "object" || error === null) return deploymentDriftFailure;
  const kind = "kind" in error ? error.kind : undefined;
  if (
    kind !== "cloudflare-authentication" &&
    kind !== "cloudflare-authorization" &&
    kind !== "cloudflare-transient"
  ) {
    return deploymentDriftFailure;
  }
  const recoveryValue = "recovery" in error ? error.recovery : undefined;
  const recovery: DeploymentRecovery =
    recoveryValue === "fix-cloudflare-access" ||
    recoveryValue === "rerun-deploy" ||
    recoveryValue === "regenerate-plan" ||
    recoveryValue === "approve-plan-digest"
      ? recoveryValue
      : "rerun-deploy";
  const resource =
    "resource" in error && typeof error.resource === "string" ? error.resource : undefined;
  const requiredPermission =
    "requiredPermission" in error && typeof error.requiredPermission === "string"
      ? error.requiredPermission
      : undefined;
  return {
    kind,
    stage: "recover",
    retryable: "retryable" in error && error.retryable === true,
    recovery,
    ...(resource === undefined ? {} : { resource }),
    ...(requiredPermission === undefined ? {} : { requiredPermission }),
  };
}

class RecoveryCloudflareError extends Error {
  public constructor(public readonly failure: CloudflareApiFailure) {
    super(`Cloudflare recovery operation failed with ${failure.kind}`);
    this.name = "RecoveryCloudflareError";
  }
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

async function deleteOrphan(resource: string, wrangler: WranglerAdapter): Promise<void> {
  if (resource === "d1") return wrangler.deleteD1("shortflare");
  if (resource === "primary-queue") return wrangler.deleteQueue("shortflare-events");
  if (resource === "dead-letter-queue") return wrangler.deleteQueue("shortflare-events-dlq");
  if (resource === "management-worker") return wrangler.deleteWorker("shortflare-management");
  if (resource === "redirect-worker") return wrangler.deleteWorker("shortflare-redirect");
  throw new Error(`Unsupported Orphan Resource '${resource}'`);
}

function isSetupEligible(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  return (
    Reflect.get(value, "setupCompletedAt") === null &&
    Reflect.get(value, "activeAdministrators") === 0
  );
}
