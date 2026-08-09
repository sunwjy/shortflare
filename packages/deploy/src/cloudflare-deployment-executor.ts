import { createHash } from "node:crypto";

import { z } from "zod";

import type { CloudflareApi, CloudflareApiFailure } from "./cloudflare-api.js";
import { writeD1Backup } from "./d1-backup.js";
import type { DeploymentAction, DeploymentPlan } from "./deployment-plan.js";
import type { DeploymentActionExecutor, DeploymentRecovery } from "./deployment-runner.js";
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

export type CloudflareDeploymentOutput = Readonly<{
  databaseId?: string;
  instanceId?: string;
  backup?: Readonly<{ path: string; sha256: string; bookmark: string }>;
  setupToken?: string;
}>;

export function createCloudflareDeploymentExecutor(
  input: Readonly<{
    api: CloudflareApi;
    wrangler: WranglerAdapter;
    accountId: string;
    existingDatabaseId?: string;
    existingInstanceId?: string;
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
  }> {
  let databaseId = input.existingDatabaseId;
  let artifacts: Awaited<ReturnType<typeof prepareWorkerArtifacts>> | undefined;
  let backup: CloudflareDeploymentOutput["backup"];
  let setupToken: string | undefined;
  let instanceId = input.existingInstanceId;

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

  async function query(sql: string, parameters: readonly string[] = []) {
    if (databaseId === undefined) throw new Error("D1 is not available");
    const result = await input.api.queryD1(input.accountId, databaseId, sql, parameters);
    if (!result.ok) throw new CloudflareExecutionError(result);
    return result.rows;
  }

  return {
    getOutput() {
      return {
        ...(databaseId === undefined ? {} : { databaseId }),
        ...(instanceId === undefined ? {} : { instanceId }),
        ...(backup === undefined ? {} : { backup }),
        ...(setupToken === undefined ? {} : { setupToken }),
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

    async revalidate(action) {
      if (action.kind === "create-d1") {
        const listed = await input.api.listD1Databases(input.accountId, resourceNames.database);
        return listed.ok && listed.databases.length === 0
          ? { ok: true }
          : { ok: false, field: "d1.shortflare" };
      }
      if (action.kind === "configure-domain" && action.domain.kind === "custom-domain") {
        const hostname = action.domain.hostname;
        const domains = await input.api.listWorkerDomains(input.accountId);
        if (!domains.ok) return { ok: false, field: `domain.${hostname}` };
        const existing = domains.domains.find((domain) => domain.hostname === hostname);
        const expectedWorker = workerName(action.worker);
        return existing === undefined || existing.worker === expectedWorker
          ? { ok: true }
          : { ok: false, field: `domain.${hostname}` };
      }
      return { ok: true };
    },

    async apply(action, plan) {
      try {
        await applyAction(action, plan);
        return { ok: true };
      } catch (error: unknown) {
        const retryable =
          error instanceof CloudflareExecutionError ? error.failure.retryable : true;
        return {
          ok: false,
          retryable,
          recovery: "rerun-deploy" as DeploymentRecovery,
        };
      }
    },
  };

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
          `INSERT INTO deployment_marker
             (singleton_key, instance_id, installation_release, created_at)
           VALUES (1, ?, ?, ?)`,
          [instanceId, plan.targetRelease, String(input.now().getTime())],
        );
        return;
      case "create-queue":
        await reconcileQueue(action.resource);
        return;
      case "configure-analytics-secret":
        await reconcileAnalyticsSecret();
        return;
      case "upload-worker": {
        const resolved = await resolvedArtifacts();
        await input.wrangler.uploadWorker(
          configFor(resolved, action.worker),
          versionTag(plan, action.worker),
        );
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
        );
        return;
      case "record-coherent-release":
        await recordCoherentRelease(plan);
        return;
      case "create-setup-handoff":
        await createSetupHandoff(action.administratorEmail);
        return;
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

  async function reconcileAnalyticsSecret() {
    const listed = await input.api.listWorkerSecretNames(input.accountId, resourceNames.redirect);
    if (!listed.ok) throw new CloudflareExecutionError(listed);
    if (listed.names.includes("ANALYTICS_HMAC_KEY")) return;
    const value = Buffer.from(input.randomBytes(32)).toString("base64url");
    await input.wrangler.putSecret(resourceNames.redirect, "ANALYTICS_HMAC_KEY", value);
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
    await pollHealth(url, 30);
  }

  async function pollHealth(url: string, attemptsRemaining: number): Promise<void> {
    try {
      const response = await input.fetch(url);
      if (response.ok) return;
    } catch {
      // A newly activated Worker can take several seconds to become reachable.
    }
    if (attemptsRemaining <= 1) throw new Error("Worker health verification timed out");
    await input.delay(1_000);
    await pollHealth(url, attemptsRemaining - 1);
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
    const tag = (worker: "management" | "redirect") => versionTag(plan, worker);
    await query(
      `INSERT INTO coherent_release
         (singleton_key, release, schema_version, management_worker_version,
          redirect_worker_version, manifest_sha256, recorded_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(singleton_key) DO UPDATE SET
         release = excluded.release,
         schema_version = excluded.schema_version,
         management_worker_version = excluded.management_worker_version,
         redirect_worker_version = excluded.redirect_worker_version,
         manifest_sha256 = excluded.manifest_sha256,
         recorded_at = excluded.recorded_at`,
      [
        plan.targetRelease,
        String(input.manifest.schema.version),
        tag("management"),
        tag("redirect"),
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
    const token = Buffer.from(input.randomBytes(32)).toString("base64url");
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
    setupToken = token;
  }
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
