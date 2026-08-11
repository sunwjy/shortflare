import { createHash } from "node:crypto";

import { z } from "zod";

import type { CloudflareApi, CloudflareApiFailure, WorkerBinding } from "./cloudflare-api.js";
import { writeD1Backup } from "./d1-backup.js";
import type { DeploymentAction, DeploymentPlan } from "./deployment-plan.js";
import type {
  DeploymentActionExecutor,
  DeploymentCloudflareFailure,
  DeploymentRecovery,
} from "./deployment-runner.js";
import type { ReleaseManifest } from "./release-manifest.js";
import { prepareWorkerArtifacts } from "./resolved-worker-artifacts.js";
import type { WranglerAdapter } from "./wrangler-adapter.js";

const resourceNames = {
  database: "shortflare",
  management: "shortflare-management",
  redirect: "shortflare-redirect",
} as const;
const queueRetentionSeconds = 86_400;
const setupEligibilitySchema = z.looseObject({
  setupCompletedAt: z.number().nullable(),
  activeAdministrators: z.number().int().nonnegative(),
});
const managementHealthSchema = z.strictObject({ status: z.literal("ok") });
const activeLinkSchema = z.looseObject({
  alias: z.string().min(1),
  destination: z.url(),
});
const migrationRowSchema = z.looseObject({ name: z.string().min(1) });

export type CloudflareDeploymentOutput = Readonly<{
  databaseId?: string;
  instanceId?: string;
  backup?: Readonly<{ path: string; sha256: string; bookmark: string }>;
  setupToken?: string;
  managementAddress?: string;
  redirectAddress?: string;
}>;

export function createCloudflareDeploymentExecutor(
  input: Readonly<{
    api: CloudflareApi;
    wrangler: WranglerAdapter;
    accountId: string;
    existingDatabaseId?: string;
    existingInstanceId?: string;
    previousWorkerVersions?: Readonly<{ management: string; redirect: string }>;
    setupToken?: string;
    releaseRoot: string;
    temporaryRoot: string;
    backupDirectory: string;
    redirectDomain: string;
    managementDomain?: string;
    manifest: ReleaseManifest;
    now: () => Date;
    randomBytes: (size: number) => Uint8Array;
    randomId: () => string;
    fetch: typeof globalThis.fetch;
    delay: (milliseconds: number) => Promise<void>;
  }>,
): DeploymentActionExecutor &
  Readonly<{
    getOutput(): CloudflareDeploymentOutput;
    getDatabaseId(): string | undefined;
    getInstanceId(): string | undefined;
    getSetupToken(): string | undefined;
    getManagementAddress(): string | undefined;
    getRedirectAddress(): string | undefined;
    getBackup(): CloudflareDeploymentOutput["backup"];
  }> {
  let databaseId = input.existingDatabaseId;
  let artifacts: Awaited<ReturnType<typeof prepareWorkerArtifacts>> | undefined;
  let backup: CloudflareDeploymentOutput["backup"];
  let setupToken: string | undefined;
  let instanceId = input.existingInstanceId;
  let managementAddress: string | undefined;
  let redirectAddress: string | undefined;

  async function resolvedArtifacts() {
    if (artifacts !== undefined) return artifacts;
    if (databaseId === undefined)
      throw new Error("D1 must exist before Worker artifacts are resolved");
    artifacts = await prepareWorkerArtifacts({
      releaseRoot: input.releaseRoot,
      temporaryRoot: input.temporaryRoot,
      accountId: input.accountId,
      databaseId,
      redirectDomain: input.redirectDomain,
      rateLimitNamespaceBase: 10_000,
    });
    return artifacts;
  }

  async function query(sql: string, parameters: readonly (string | null)[] = []) {
    if (databaseId === undefined) throw new Error("D1 is not available");
    const result = await input.api.queryD1(input.accountId, databaseId, sql, parameters);
    if (!result.ok) throw new CloudflareExecutionError(result);
    return result.rows;
  }

  async function queryMissingTableAsEmpty(sql: string): Promise<readonly unknown[]> {
    try {
      return await query(sql);
    } catch (error: unknown) {
      if (error instanceof CloudflareExecutionError && error.failure.status === 400) return [];
      throw error;
    }
  }

  return {
    getOutput() {
      return {
        ...(databaseId === undefined ? {} : { databaseId }),
        ...(instanceId === undefined ? {} : { instanceId }),
        ...(backup === undefined ? {} : { backup }),
        ...(setupToken === undefined ? {} : { setupToken }),
        ...(managementAddress === undefined ? {} : { managementAddress }),
        ...(redirectAddress === undefined ? {} : { redirectAddress }),
      };
    },
    getDatabaseId() {
      return databaseId;
    },
    getInstanceId() {
      return instanceId;
    },
    getSetupToken() {
      return setupToken;
    },
    getManagementAddress() {
      return managementAddress;
    },
    getRedirectAddress() {
      return redirectAddress;
    },
    getBackup() {
      return backup;
    },
    actionMetadata(action) {
      return (action.kind === "export-d1" ||
        action.kind === "verify-backup" ||
        action.kind === "apply-migrations") &&
        backup !== undefined
        ? { backup }
        : undefined;
    },

    async checkpointValid(action, plan) {
      try {
        return (await validateCheckpoint(action, plan)) ? { ok: true } : { ok: false };
      } catch {
        return { ok: false };
      }
    },

    async revalidate(action, plan) {
      if (action.kind === "create-d1") {
        const listed = await input.api.listD1Databases(input.accountId, resourceNames.database);
        if (!listed.ok) {
          return { ok: false, field: "d1.shortflare", ...cloudflareFailure(listed) };
        }
        return listed.ok && listed.databases.length === 0
          ? { ok: true }
          : { ok: false, field: "d1.shortflare" };
      }
      if (action.kind === "configure-domain" && action.domain.kind === "custom-domain") {
        const hostname = action.domain.hostname;
        const domains = await input.api.listWorkerDomains(input.accountId);
        if (!domains.ok) {
          return { ok: false, field: `domain.${hostname}`, ...cloudflareFailure(domains) };
        }
        const existing = domains.domains.find((domain) => domain.hostname === hostname);
        const expectedWorker = workerName(action.worker);
        return existing === undefined || existing.worker === expectedWorker
          ? { ok: true }
          : { ok: false, field: `domain.${hostname}` };
      }
      if (action.kind === "create-queue") {
        const queues = await input.api.listQueues(input.accountId);
        if (!queues.ok) {
          return { ok: false, field: `queue.${action.resource}`, ...cloudflareFailure(queues) };
        }
        // A present Instance owns its reserved Queue names. The action reconciles
        // existing settings, which is required for safe interrupted reruns.
        return { ok: true };
      }
      if (action.kind === "write-deployment-marker") {
        const rows = await queryMissingTableAsEmpty(
          "SELECT instance_id FROM deployment_marker WHERE singleton_key = 1",
        );
        return rows.length === 0 ? { ok: true } : { ok: false, field: "d1.deploymentMarker" };
      }
      if (action.kind === "apply-migrations") {
        const rows = await queryMissingTableAsEmpty("SELECT name FROM d1_migrations ORDER BY id");
        const known = new Set(input.manifest.schema.migrations);
        const unexpected = rows.some((row) => {
          const parsed = migrationRowSchema.safeParse(row);
          return !parsed.success || !known.has(parsed.data.name);
        });
        return unexpected ? { ok: false, field: "d1.migrationJournal" } : { ok: true };
      }
      if (action.kind === "activate-worker") {
        try {
          await input.wrangler.resolveVersionId(
            configFor(await resolvedArtifacts(), action.worker),
            versionTag(plan, action.worker),
          );
          return { ok: true };
        } catch {
          return { ok: false, field: `worker.${action.worker}.uploadedVersion` };
        }
      }
      if (action.kind === "record-coherent-release") {
        const resolved = await resolvedArtifacts();
        const [managementVersionId, redirectVersionId] = await Promise.all([
          input.wrangler.resolveVersionId(
            resolved.managementConfig,
            versionTag(plan, "management"),
          ),
          input.wrangler.resolveVersionId(resolved.redirectConfig, versionTag(plan, "redirect")),
        ]);
        try {
          await validateControlPlane(managementVersionId, redirectVersionId);
          return { ok: true };
        } catch {
          return { ok: false, field: "release.controlPlane" };
        }
      }
      return { ok: true };
    },

    async apply(action, plan) {
      try {
        await applyAction(action, plan);
        return { ok: true };
      } catch (error: unknown) {
        await rollbackAfterFailedVerification(action, plan);
        const retryable =
          error instanceof CloudflareExecutionError ? error.failure.retryable : true;
        return {
          ok: false,
          retryable,
          recovery: "rerun-deploy" as DeploymentRecovery,
          ...(error instanceof CloudflareExecutionError ? cloudflareFailure(error.failure) : {}),
        };
      }
    },
  };

  async function validateCheckpoint(
    action: DeploymentAction,
    plan: DeploymentPlan,
  ): Promise<boolean> {
    switch (action.kind) {
      case "create-d1": {
        const listed = await input.api.listD1Databases(input.accountId, resourceNames.database);
        return (
          listed.ok &&
          listed.databases.some(
            (database) => database.id === databaseId && database.name === resourceNames.database,
          )
        );
      }
      case "write-deployment-marker": {
        const rows = await query(
          "SELECT instance_id AS instanceId FROM deployment_marker WHERE singleton_key = 1",
        );
        return (
          z.looseObject({ instanceId: z.string() }).safeParse(rows[0]).data?.instanceId ===
          instanceId
        );
      }
      case "create-queue": {
        const queues = await input.api.listQueues(input.accountId);
        return (
          queues.ok &&
          queues.queues.some(
            (queue) =>
              queue.name === action.resource &&
              queue.settings.messageRetentionPeriod === queueRetentionSeconds,
          )
        );
      }
      case "configure-analytics-secret": {
        const secrets = await input.api.listWorkerSecretNames(
          input.accountId,
          resourceNames.redirect,
        );
        return secrets.ok && secrets.names.includes("ANALYTICS_HMAC_KEY");
      }
      case "upload-worker": {
        await input.wrangler.resolveVersionId(
          configFor(await resolvedArtifacts(), action.worker),
          versionTag(plan, action.worker),
        );
        return true;
      }
      case "activate-worker": {
        const versionId = await input.wrangler.resolveVersionId(
          configFor(await resolvedArtifacts(), action.worker),
          versionTag(plan, action.worker),
        );
        const active = await input.api.listActiveWorkerVersions(
          input.accountId,
          workerName(action.worker),
        );
        return active.ok && active.versionIds.includes(versionId);
      }
      case "configure-domain": {
        if (action.domain.kind === "workers-dev") {
          const subdomain = await input.api.getWorkersSubdomain(input.accountId);
          return subdomain.ok && subdomain.registered;
        }
        const domains = await input.api.listWorkerDomains(input.accountId);
        const hostname = action.domain.hostname;
        return (
          domains.ok &&
          domains.domains.some(
            (domain) => domain.hostname === hostname && domain.worker === workerName(action.worker),
          )
        );
      }
      case "verify-worker":
        await verifyWorker(action.worker);
        return true;
      case "apply-migrations": {
        const rows = await query("SELECT name FROM d1_migrations ORDER BY id");
        const applied = new Set(
          rows.flatMap((row) => {
            const parsed = migrationRowSchema.safeParse(row);
            return parsed.success ? [parsed.data.name] : [];
          }),
        );
        return action.migrations.every((migration) => applied.has(migration));
      }
      case "record-coherent-release": {
        const rows = await query(
          `SELECT release, manifest_sha256 AS manifestSha256
           FROM coherent_release WHERE singleton_key = 1`,
        );
        const parsed = z
          .looseObject({ release: z.string(), manifestSha256: z.string() })
          .safeParse(rows[0]);
        return (
          parsed.success &&
          parsed.data.release === plan.targetRelease &&
          parsed.data.manifestSha256 === plan.targetManifestDigest
        );
      }
      case "create-setup-handoff": {
        const rows = await query(
          `SELECT EXISTS(SELECT 1 FROM initial_setup WHERE singleton_key = 1) AS present`,
        );
        return z.looseObject({ present: z.literal(1) }).safeParse(rows[0]).success;
      }
      case "export-d1":
      case "verify-backup":
        return backup !== undefined;
      case "recover":
        return false;
    }
  }

  async function rollbackAfterFailedVerification(
    action: DeploymentAction,
    plan: DeploymentPlan,
  ): Promise<void> {
    if (
      action.kind !== "verify-worker" ||
      plan.sourceRelease === "fresh" ||
      !input.manifest.rollbackSafeFrom.includes(plan.sourceRelease) ||
      !(await rollbackStillCompatible())
    ) {
      return;
    }
    // Redirect is activated only after Management. If Redirect verification fails,
    // restore the whole coherent pair in reverse activation order so observation on
    // the next run does not mistake the expected transition for critical drift.
    const rollbackWorkers =
      action.worker === "redirect"
        ? (["redirect", "management"] as const)
        : (["management"] as const);
    try {
      await rollbackWorkerAt(rollbackWorkers, 0);
    } catch {
      // The original verification failure remains authoritative; diagnosis exposes the live version.
    }
  }

  async function rollbackWorkerAt(
    workers: readonly ("management" | "redirect")[],
    index: number,
  ): Promise<void> {
    const worker = workers[index];
    if (worker === undefined) return;
    const previousVersionId = input.previousWorkerVersions?.[worker];
    if (previousVersionId === undefined) return;
    const name = workerName(worker);
    await input.wrangler.activateWorkerVersion(name, previousVersionId);
    const active = await input.api.listActiveWorkerVersions(input.accountId, name);
    if (!active.ok || !active.versionIds.includes(previousVersionId)) {
      throw new Error(`Automatic ${worker} rollback failed verification`);
    }
    await rollbackWorkerAt(workers, index + 1);
  }

  async function rollbackStillCompatible(): Promise<boolean> {
    if (databaseId === undefined) return false;
    const [migrationRows, managementBindings, redirectBindings] = await Promise.all([
      query("SELECT name FROM d1_migrations ORDER BY id"),
      input.api.listWorkerBindings(input.accountId, resourceNames.management),
      input.api.listWorkerBindings(input.accountId, resourceNames.redirect),
    ]);
    if (!managementBindings.ok || !redirectBindings.ok) return false;
    const applied = new Set(
      migrationRows.flatMap((row) => {
        const parsed = migrationRowSchema.safeParse(row);
        return parsed.success ? [parsed.data.name] : [];
      }),
    );
    return (
      input.manifest.schema.migrations.every((migration) => applied.has(migration)) &&
      bindingsCompatible(managementBindings.bindings, redirectBindings.bindings)
    );
  }

  function bindingsCompatible(
    management: readonly WorkerBinding[],
    redirect: readonly WorkerBinding[],
  ): boolean {
    const hasDatabase = (bindings: readonly WorkerBinding[]) =>
      bindings.some(
        (binding) =>
          binding.type === "d1" && binding.name === "DB" && binding.databaseId === databaseId,
      );
    return (
      hasDatabase(management) &&
      hasDatabase(redirect) &&
      redirect.some(
        (binding) =>
          binding.type === "queue" &&
          binding.name === "ANALYTICS_QUEUE" &&
          binding.queueName === "shortflare-events",
      )
    );
  }

  async function applyAction(action: DeploymentAction, plan: DeploymentPlan): Promise<void> {
    switch (action.kind) {
      case "create-d1": {
        const created = await input.api.createD1Database(input.accountId, resourceNames.database);
        if (!created.ok) throw new CloudflareExecutionError(created);
        databaseId = created.database.id;
        return;
      }
      case "apply-migrations": {
        const resolved = await resolvedArtifacts();
        await input.wrangler.applyMigrations(resolved.managementConfig);
        return;
      }
      case "write-deployment-marker":
        instanceId = input.randomId();
        await query(
          `CREATE TABLE IF NOT EXISTS deployment_marker (
             singleton_key INTEGER PRIMARY KEY NOT NULL,
             instance_id TEXT NOT NULL,
             installation_release TEXT NOT NULL,
             created_at INTEGER NOT NULL,
             CONSTRAINT deployment_marker_singleton_key_check
               CHECK(typeof(singleton_key) = 'integer' AND singleton_key = 1),
             CONSTRAINT deployment_marker_instance_id_check
               CHECK(length(instance_id) BETWEEN 1 AND 128),
             CONSTRAINT deployment_marker_installation_release_check
               CHECK(length(installation_release) BETWEEN 1 AND 128),
             CONSTRAINT deployment_marker_created_at_check
               CHECK(typeof(created_at) = 'integer' AND created_at >= 0)
           )`,
        );
        await query(
          `CREATE TRIGGER IF NOT EXISTS deployment_marker_immutable
           BEFORE UPDATE ON deployment_marker
           BEGIN
             SELECT RAISE(ABORT, 'deployment marker is immutable');
           END`,
        );
        await query(
          `INSERT INTO deployment_marker
             (singleton_key, instance_id, installation_release, created_at)
           VALUES (1, ?, ?, ?)`,
          [instanceId, plan.targetRelease, String(input.now().getTime())],
        );
        // The lease tables are bootstrapped immediately after identity so migrations are the
        // first mutable Instance effect protected by a fenced Deployment Lease (ADR-0032).
        await query(
          `CREATE TABLE IF NOT EXISTS deployment_attempts (
             id TEXT PRIMARY KEY NOT NULL,
             plan_digest TEXT NOT NULL,
             source_release TEXT NOT NULL,
             target_release TEXT NOT NULL,
             status TEXT NOT NULL,
             completed_actions TEXT NOT NULL,
             started_at INTEGER NOT NULL,
             updated_at INTEGER NOT NULL,
             failure_kind TEXT,
             failed_stage TEXT,
             CONSTRAINT deployment_attempts_id_check CHECK(length(id) BETWEEN 1 AND 128),
             CONSTRAINT deployment_attempts_plan_digest_check
               CHECK(length(plan_digest) = 64 AND plan_digest NOT GLOB '*[^0-9a-f]*'),
             CONSTRAINT deployment_attempts_source_release_check
               CHECK(length(source_release) BETWEEN 1 AND 128),
             CONSTRAINT deployment_attempts_target_release_check
               CHECK(length(target_release) BETWEEN 1 AND 128),
             CONSTRAINT deployment_attempts_status_check
               CHECK(status IN ('running', 'failed', 'coherent')),
             CONSTRAINT deployment_attempts_completed_actions_check
               CHECK(json_valid(completed_actions) AND json_type(completed_actions) = 'array'),
             CONSTRAINT deployment_attempts_started_at_check
               CHECK(typeof(started_at) = 'integer' AND started_at >= 0),
             CONSTRAINT deployment_attempts_updated_at_check
               CHECK(typeof(updated_at) = 'integer' AND updated_at >= 0),
             CONSTRAINT deployment_attempts_time_order_check CHECK(updated_at >= started_at),
             CONSTRAINT deployment_attempts_failure_check
               CHECK((status = 'failed' AND failure_kind IS NOT NULL AND failed_stage IS NOT NULL)
                 OR (status != 'failed' AND failure_kind IS NULL AND failed_stage IS NULL))
           )`,
        );
        await query(
          `CREATE INDEX IF NOT EXISTS deployment_attempts_status_idx
           ON deployment_attempts (status, updated_at)`,
        );
        await query(
          `CREATE TABLE IF NOT EXISTS deployment_lease (
             singleton_key INTEGER PRIMARY KEY NOT NULL,
             attempt_id TEXT NOT NULL,
             expires_at INTEGER NOT NULL,
             fencing_token INTEGER NOT NULL,
             FOREIGN KEY (attempt_id) REFERENCES deployment_attempts(id)
               ON UPDATE NO ACTION ON DELETE RESTRICT,
             CONSTRAINT deployment_lease_singleton_key_check
               CHECK(typeof(singleton_key) = 'integer' AND singleton_key = 1),
             CONSTRAINT deployment_lease_expires_at_check
               CHECK(typeof(expires_at) = 'integer' AND expires_at >= 0),
             CONSTRAINT deployment_lease_fencing_token_check
               CHECK(typeof(fencing_token) = 'integer' AND fencing_token > 0)
           )`,
        );
        return;
      case "create-queue":
        await reconcileQueue(action.resource);
        return;
      case "configure-analytics-secret":
        await reconcileAnalyticsSecret(plan);
        return;
      case "upload-worker": {
        const resolved = await resolvedArtifacts();
        const scripts = await input.api.listWorkerScripts(input.accountId);
        if (!scripts.ok) throw new CloudflareExecutionError(scripts);
        const config = configFor(resolved, action.worker);
        const tag = versionTag(plan, action.worker);
        const exists = scripts.scripts.some((script) => script.name === workerName(action.worker));
        if (exists) await input.wrangler.uploadWorker(config, tag);
        else await input.wrangler.deployNewWorker(config, tag);
        return;
      }
      case "activate-worker": {
        const resolved = await resolvedArtifacts();
        await input.wrangler.activateWorker(
          configFor(resolved, action.worker),
          versionTag(plan, action.worker),
        );
        return;
      }
      case "configure-domain":
        await reconcileDomain(action);
        return;
      case "verify-worker":
        await verifyWorker(action.worker);
        return;
      case "export-d1":
        await exportDatabase(plan);
        return;
      case "verify-backup":
        if (backup === undefined) throw new Error("D1 backup was not completed");
        await input.wrangler.verifyBackup(
          (await resolvedArtifacts()).managementConfig,
          backup.path,
          `${input.temporaryRoot}-backup-validation`,
          {
            instanceId: instanceId ?? "missing-instance",
            sourceRelease: plan.sourceRelease,
          },
        );
        return;
      case "record-coherent-release":
        await recordCoherentRelease(plan);
        return;
      case "create-setup-handoff":
        await createSetupHandoff(action.administratorEmail);
        return;
      case "recover":
        throw new Error("Recovery actions require the recovery executor");
    }
  }

  async function reconcileQueue(name: "shortflare-events" | "shortflare-events-dlq") {
    const listed = await input.api.listQueues(input.accountId);
    if (!listed.ok) throw new CloudflareExecutionError(listed);
    const existing = listed.queues.find((queue) => queue.name === name);
    if (existing === undefined) {
      const created = await input.api.createQueue(input.accountId, name, queueRetentionSeconds);
      if (!created.ok) throw new CloudflareExecutionError(created);
      return;
    }
    if (existing.settings.messageRetentionPeriod !== queueRetentionSeconds) {
      const updated = await input.api.updateQueueRetention(
        input.accountId,
        existing,
        queueRetentionSeconds,
      );
      if (!updated.ok) throw new CloudflareExecutionError(updated);
    }
  }

  async function reconcileAnalyticsSecret(plan: DeploymentPlan) {
    const listed = await input.api.listWorkerSecretNames(input.accountId, resourceNames.redirect);
    if (!listed.ok) throw new CloudflareExecutionError(listed);
    if (listed.names.includes("ANALYTICS_HMAC_KEY")) return;
    const value = Buffer.from(input.randomBytes(32)).toString("base64url");
    // A versioned secret can be attached to an uploaded-but-not-yet-deployed Worker.
    await input.wrangler.putVersionSecret(
      resourceNames.redirect,
      "ANALYTICS_HMAC_KEY",
      value,
      versionTag(plan, "redirect"),
    );
  }

  async function reconcileDomain(action: Extract<DeploymentAction, { kind: "configure-domain" }>) {
    if (action.domain.kind === "workers-dev") return;
    const hostname = action.domain.hostname;
    const listed = await input.api.listWorkerDomains(input.accountId);
    if (!listed.ok) throw new CloudflareExecutionError(listed);
    const existing = listed.domains.find((domain) => domain.hostname === hostname);
    if (existing?.worker === workerName(action.worker)) return;
    if (existing !== undefined) throw new Error("Custom domain belongs to another Worker");
    const attached = await input.api.attachWorkerDomain(
      input.accountId,
      hostname,
      workerName(action.worker),
    );
    if (!attached.ok) throw new CloudflareExecutionError(attached);
  }

  async function verifyWorker(worker: "management" | "redirect") {
    let url: string;
    if (worker === "redirect") {
      url = `https://${input.redirectDomain}/`;
    } else if (input.managementDomain !== undefined) {
      url = `https://${input.managementDomain}/api/internal/health`;
    } else {
      const subdomain = await input.api.getWorkersSubdomain(input.accountId);
      if (!subdomain.ok) throw new CloudflareExecutionError(subdomain);
      if (!subdomain.registered) throw new Error("workers.dev subdomain is not registered");
      url = `https://${resourceNames.management}.${subdomain.subdomain}.workers.dev/api/internal/health`;
    }
    await pollHealth(url, 30, async (response) => {
      if (!response.ok) return false;
      if (worker === "redirect") return true;
      const payload: unknown = await response.json().catch(() => undefined);
      return managementHealthSchema.safeParse(payload).success;
    });
    if (worker === "redirect") {
      await verifyActiveLink();
      redirectAddress = `https://${input.redirectDomain}`;
    } else {
      managementAddress = url.replace(/\/api\/internal\/health$/, "");
    }
  }

  async function pollHealth(
    url: string,
    attemptsRemaining: number,
    accepts: (response: Response) => Promise<boolean>,
  ): Promise<void> {
    try {
      const response = await input.fetch(url);
      if (await accepts(response)) return;
    } catch {
      // A newly activated Worker can take several seconds to become reachable.
    }
    if (attemptsRemaining <= 1) throw new Error("Worker health verification timed out");
    await input.delay(1_000);
    await pollHealth(url, attemptsRemaining - 1, accepts);
  }

  async function verifyActiveLink(): Promise<void> {
    const rows = await query(
      `SELECT a.alias, d.destination
       FROM links l
       JOIN aliases a ON a.link_id = l.id
       JOIN destination_versions d ON d.link_id = l.id
       WHERE l.state = 'active'
       ORDER BY d.version_number DESC LIMIT 1`,
    );
    const link = activeLinkSchema.safeParse(rows[0]);
    if (!link.success) return;
    const response = await input.fetch(`https://${input.redirectDomain}/${link.data.alias}`, {
      method: "HEAD",
      redirect: "manual",
    });
    if (response.status !== 302 || response.headers.get("location") !== link.data.destination) {
      throw new Error("Active Link verification failed");
    }
  }

  async function validateControlPlane(
    managementVersionId: string,
    redirectVersionId: string,
  ): Promise<void> {
    if (databaseId === undefined) throw new Error("D1 is not available");
    const [
      markerRows,
      migrationRows,
      queues,
      secrets,
      domains,
      managementBindings,
      redirectBindings,
      managementVersions,
      redirectVersions,
    ] = await Promise.all([
      query(`SELECT instance_id AS instanceId FROM deployment_marker WHERE singleton_key = 1`),
      query(`SELECT name FROM d1_migrations ORDER BY id`),
      input.api.listQueues(input.accountId),
      input.api.listWorkerSecretNames(input.accountId, resourceNames.redirect),
      input.api.listWorkerDomains(input.accountId),
      input.api.listWorkerBindings(input.accountId, resourceNames.management),
      input.api.listWorkerBindings(input.accountId, resourceNames.redirect),
      input.api.listActiveWorkerVersions(input.accountId, resourceNames.management),
      input.api.listActiveWorkerVersions(input.accountId, resourceNames.redirect),
    ]);
    const marker = z.looseObject({ instanceId: z.string().min(1) }).safeParse(markerRows[0]);
    const applied = new Set(
      migrationRows.flatMap((row) => {
        const parsed = migrationRowSchema.safeParse(row);
        return parsed.success ? [parsed.data.name] : [];
      }),
    );
    const appliedInOrder = migrationRows.flatMap((row) => {
      const parsed = migrationRowSchema.safeParse(row);
      return parsed.success ? [parsed.data.name] : [];
    });
    if (
      !marker.success ||
      marker.data.instanceId !== instanceId ||
      input.manifest.schema.migrations.some((migration) => !applied.has(migration)) ||
      appliedInOrder.length !== input.manifest.schema.migrations.length ||
      appliedInOrder.some(
        (migration, index) => migration !== input.manifest.schema.migrations[index],
      ) ||
      !queues.ok ||
      !secrets.ok ||
      !domains.ok ||
      !managementBindings.ok ||
      !redirectBindings.ok ||
      !managementVersions.ok ||
      !redirectVersions.ok
    ) {
      throw new Error("Control-plane verification failed");
    }
    for (const name of ["shortflare-events", "shortflare-events-dlq"]) {
      const queue = queues.queues.find((candidate) => candidate.name === name);
      if (queue?.settings.messageRetentionPeriod !== queueRetentionSeconds) {
        throw new Error(`Queue '${name}' failed verification`);
      }
    }
    const primaryQueue = queues.queues.find((candidate) => candidate.name === "shortflare-events");
    const deadLetterQueue = queues.queues.find(
      (candidate) => candidate.name === "shortflare-events-dlq",
    );
    const matchingConsumers =
      primaryQueue?.consumers.filter(
        (consumer) =>
          consumer.type === "worker" &&
          consumer.scriptName === resourceNames.management &&
          consumer.deadLetterQueue === "shortflare-events-dlq" &&
          consumer.maxRetries === 3 &&
          consumer.maxBatchSize === 10 &&
          consumer.maxBatchTimeout === 1 &&
          consumer.maxConcurrency === 1 &&
          consumer.retryDelay === 60,
      ) ?? [];
    if (
      !primaryQueue?.producers.some(
        (producer) => producer.type === "worker" && producer.script === resourceNames.redirect,
      ) ||
      matchingConsumers.length !== 1 ||
      primaryQueue.consumers.length !== 1 ||
      deadLetterQueue?.consumers.length !== 0
    ) {
      throw new Error("Queue producer or consumer failed verification");
    }
    if (
      !bindingMatches(managementBindings.bindings, "DB", "d1", databaseId) ||
      !bindingMatches(redirectBindings.bindings, "DB", "d1", databaseId) ||
      !bindingMatches(redirectBindings.bindings, "ANALYTICS_QUEUE", "queue", "shortflare-events")
    ) {
      throw new Error("Worker bindings failed verification");
    }
    if (
      !managementVersions.versionIds.includes(managementVersionId) ||
      !redirectVersions.versionIds.includes(redirectVersionId)
    ) {
      throw new Error("Active Worker versions failed verification");
    }
    if (!secrets.names.includes("ANALYTICS_HMAC_KEY")) {
      throw new Error("Analytics secret binding failed verification");
    }
    const redirectDomain = domains.domains.find(
      (domain) => domain.hostname === input.redirectDomain,
    );
    if (redirectDomain?.worker !== resourceNames.redirect) {
      throw new Error("Redirect Custom Domain failed verification");
    }
    if (input.managementDomain !== undefined) {
      const managementDomain = domains.domains.find(
        (domain) => domain.hostname === input.managementDomain,
      );
      if (managementDomain?.worker !== resourceNames.management) {
        throw new Error("Management Custom Domain failed verification");
      }
    }
  }

  async function exportDatabase(plan: DeploymentPlan) {
    if (databaseId === undefined) throw new Error("D1 is not available");
    const started = await input.api.beginD1Export(input.accountId, databaseId);
    if (!started.ok) throw new CloudflareExecutionError(started);
    const downloadUrl = await pollExport(databaseId, started.bookmark, 60);
    const response = await input.fetch(downloadUrl);
    if (!response.ok || response.body === null) throw new Error("D1 export download failed");
    const written = await writeD1Backup({
      directory: input.backupDirectory,
      sourceRelease: plan.sourceRelease,
      targetRelease: plan.targetRelease,
      createdAt: input.now(),
      body: response.body,
    });
    backup = { ...written, bookmark: started.bookmark };
  }

  async function pollExport(
    currentDatabaseId: string,
    bookmark: string,
    attemptsRemaining: number,
  ): Promise<string> {
    const polled = await input.api.pollD1Export(input.accountId, currentDatabaseId, bookmark);
    if (!polled.ok) throw new CloudflareExecutionError(polled);
    if (polled.state === "ready") return polled.downloadUrl;
    if (attemptsRemaining <= 1) throw new Error("D1 export timed out");
    await input.delay(1_000);
    return pollExport(currentDatabaseId, bookmark, attemptsRemaining - 1);
  }

  async function recordCoherentRelease(plan: DeploymentPlan) {
    const resolved = await resolvedArtifacts();
    const [managementVersionId, redirectVersionId] = await Promise.all([
      input.wrangler.resolveVersionId(resolved.managementConfig, versionTag(plan, "management")),
      input.wrangler.resolveVersionId(resolved.redirectConfig, versionTag(plan, "redirect")),
    ]);
    await validateControlPlane(managementVersionId, redirectVersionId);
    await query(
      `INSERT INTO coherent_release
         (singleton_key, release, schema_version, management_worker_version,
          redirect_worker_version, management_artifact_sha256,
          redirect_artifact_sha256, migration_journal_sha256, manifest_sha256, recorded_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(singleton_key) DO UPDATE SET
         release = excluded.release,
         schema_version = excluded.schema_version,
         management_worker_version = excluded.management_worker_version,
         redirect_worker_version = excluded.redirect_worker_version,
         management_artifact_sha256 = excluded.management_artifact_sha256,
         redirect_artifact_sha256 = excluded.redirect_artifact_sha256,
         migration_journal_sha256 = excluded.migration_journal_sha256,
         manifest_sha256 = excluded.manifest_sha256,
         recorded_at = excluded.recorded_at`,
      [
        plan.targetRelease,
        String(input.manifest.schema.version),
        managementVersionId,
        redirectVersionId,
        input.manifest.artifacts.management.sha256,
        input.manifest.artifacts.redirect.sha256,
        input.manifest.schema.journalSha256,
        plan.targetManifestDigest,
        String(input.now().getTime()),
      ],
    );
  }

  async function createSetupHandoff(administratorEmail: string) {
    const eligibilityRows = await query(
      `SELECT i.setup_completed_at AS setupCompletedAt,
              COUNT(u.id) AS activeAdministrators
       FROM instances i
       LEFT JOIN users u ON u.state = 'active' AND u.role = 'administrator'
       WHERE i.singleton_key = 1
       GROUP BY i.singleton_key, i.setup_completed_at`,
    );
    const eligibility = setupEligibilitySchema.parse(eligibilityRows[0]);
    if (eligibility.setupCompletedAt !== null || eligibility.activeAdministrators > 0) return;
    const existing = await query(
      `SELECT expires_at AS expiresAt FROM initial_setup WHERE singleton_key = 1
       AND expires_at > ? LIMIT 1`,
      [String(input.now().getTime())],
    );
    if (existing.length > 0) return;
    const token = input.setupToken ?? Buffer.from(input.randomBytes(32)).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const createdAt = input.now().getTime();
    await query(
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
        tokenHash,
        String(createdAt),
        String(createdAt + 30 * 60_000),
      ],
    );
    if (input.setupToken === undefined) setupToken = token;
  }
}

function bindingMatches(
  bindings: readonly WorkerBinding[],
  name: string,
  type: "d1" | "queue",
  resource: string,
): boolean {
  return bindings.some(
    (binding) =>
      binding.name === name &&
      binding.type === type &&
      (type === "d1" ? binding.databaseId === resource : binding.queueName === resource),
  );
}

function workerName(worker: "management" | "redirect"): string {
  return worker === "management" ? resourceNames.management : resourceNames.redirect;
}

function configFor(
  artifacts: Awaited<ReturnType<typeof prepareWorkerArtifacts>>,
  worker: "management" | "redirect",
): string {
  return worker === "management" ? artifacts.managementConfig : artifacts.redirectConfig;
}

function versionTag(plan: DeploymentPlan, worker: "management" | "redirect"): string {
  return `${plan.targetRelease}-${worker}`;
}

class CloudflareExecutionError extends Error {
  public constructor(public readonly failure: CloudflareApiFailure) {
    super(`Cloudflare operation failed with ${failure.kind}`);
    this.name = "CloudflareExecutionError";
  }
}

function cloudflareFailure(
  failure: CloudflareApiFailure,
): Readonly<{ failure?: DeploymentCloudflareFailure }> {
  if (
    failure.kind !== "cloudflare-authentication" &&
    failure.kind !== "cloudflare-authorization" &&
    failure.kind !== "cloudflare-transient"
  ) {
    return {};
  }
  return {
    failure: {
      kind: failure.kind,
      retryable: failure.retryable,
      ...(failure.resource === undefined ? {} : { resource: failure.resource }),
      ...(failure.requiredPermission === undefined
        ? {}
        : { requiredPermission: failure.requiredPermission }),
    },
  };
}
