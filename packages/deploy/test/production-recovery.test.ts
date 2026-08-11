import { describe, expect, it } from "vitest";

import type { CloudflareApi } from "../src/cloudflare-api";
import { createProductionRecovery } from "../src/production-recovery";
import { releaseOwnershipPolicy } from "../src/release-manifest";
import { createWranglerAdapter } from "../src/wrangler-adapter";

describe("production recovery", () => {
  it("preserves authorization resource and permission during recovery observation", async () => {
    const recover = createProductionRecovery({
      api: authorizationFailureApi(),
      manifest: releaseManifest(),
      now: () => new Date(1_000),
      wranglerForAccount: () =>
        createWranglerAdapter({
          run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        }),
    });

    await expect(
      recover("account-1", {
        kind: "recover",
        mode: "json",
        action: "setup-token",
        approval: { kind: "none" },
        administratorEmail: "owner@example.com",
        secretFromStdin: false,
      }),
    ).resolves.toMatchObject({
      ok: false,
      exitCode: 7,
      error: {
        kind: "cloudflare-authorization",
        failedStage: "observation",
        resource: "/accounts/account-1/d1/database",
        requiredPermission: "Account D1 Read",
      },
    });
  });

  it("seals an approved recovery authorization failure with actionable detail", async () => {
    const failureUpdates: (string | null)[][] = [];
    const api = presentRecoveryApi(failureUpdates);
    const recover = createProductionRecovery({
      api,
      manifest: releaseManifest(),
      now: () => new Date(1_000),
      wranglerForAccount: () =>
        createWranglerAdapter({
          run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        }),
    });
    const command = {
      kind: "recover" as const,
      mode: "json" as const,
      action: "setup-token" as const,
      approval: { kind: "none" as const },
      administratorEmail: "owner@example.com",
      secretFromStdin: false,
    };
    const planned = await recover("account-1", command);
    const plan = planned.plan;
    if (typeof plan !== "object" || plan === null || !("digest" in plan)) {
      throw new Error("Recovery plan digest was not returned");
    }
    const digest = plan.digest;
    if (typeof digest !== "string") throw new Error("Recovery plan digest is invalid");

    await expect(
      recover("account-1", {
        ...command,
        approval: { kind: "plan-digest", digest },
      }),
    ).resolves.toMatchObject({
      ok: false,
      exitCode: 7,
      error: {
        kind: "cloudflare-authorization",
        failedStage: "setup-eligibility",
        resource: "/accounts/account-1/d1/database/database-1/query",
        requiredPermission: "Account D1 Read",
      },
    });
    expect(failureUpdates).toHaveLength(1);
    expect(failureUpdates[0]).toEqual(
      expect.arrayContaining([
        "cloudflare-authorization",
        "recover",
        "fix-cloudflare-access",
        "/accounts/account-1/d1/database/database-1/query",
        "Account D1 Read",
      ]),
    );
  });
});

function presentRecoveryApi(failureUpdates: (string | null)[][]): CloudflareApi {
  const base = authorizationFailureApi();
  return {
    ...base,
    listD1Databases: async () => ({
      ok: true,
      databases: [{ id: "database-1", name: "shortflare" }],
    }),
    queryD1: async (_accountId, _databaseId, sql, parameters = []) => {
      if (sql.includes("FROM deployment_marker")) {
        return { ok: true, rows: [{ instanceId: "instance-1" }] };
      }
      if (sql.includes("management_worker_version AS managementWorkerVersion")) {
        return {
          ok: true,
          rows: [
            {
              release: "0.0.0",
              schemaVersion: 9,
              managementWorkerVersion: "management-v0",
              redirectWorkerVersion: "redirect-v0",
            },
          ],
        };
      }
      if (sql.includes("management_artifact_sha256 AS managementArtifactSha256")) {
        return { ok: true, rows: [] };
      }
      if (sql.includes("SELECT name FROM d1_migrations")) {
        return { ok: true, rows: [{ name: "0009_famous_leo.sql" }] };
      }
      if (sql.includes("EXISTS(SELECT 1 FROM initial_setup")) {
        return {
          ok: true,
          rows: [{ setupCompletedAt: null, activeAdministrators: 0, validSetup: 0 }],
        };
      }
      if (sql.includes("FROM deployment_attempts WHERE status IN")) {
        return { ok: true, rows: [] };
      }
      if (sql.startsWith("PRAGMA table_info")) {
        return {
          ok: true,
          rows: [
            { name: "stage_outcomes" },
            { name: "failure_resource" },
            { name: "required_permission" },
          ],
        };
      }
      if (sql.includes("FROM deployment_attempts")) return { ok: true, rows: [] };
      if (sql.includes("RETURNING fencing_token")) {
        return { ok: true, rows: [{ fencingToken: 1 }] };
      }
      if (sql.includes("UPDATE deployment_attempts") && sql.includes("failure_resource")) {
        failureUpdates.push([...parameters]);
        return { ok: true, rows: [] };
      }
      if (sql.includes("setup_completed_at AS setupCompletedAt")) {
        return {
          ok: false,
          kind: "cloudflare-authorization",
          status: 403,
          retryable: false,
          resource: "/accounts/account-1/d1/database/database-1/query",
          requiredPermission: "Account D1 Read",
        };
      }
      return { ok: true, rows: [] };
    },
    listWorkerDomains: async () => ({
      ok: true,
      domains: [
        {
          id: "domain-1",
          hostname: "go.example.com",
          worker: "shortflare-redirect",
        },
      ],
    }),
    listWorkerSecretNames: async () => ({ ok: true, names: ["ANALYTICS_HMAC_KEY"] }),
    listWorkerScripts: async () => ({
      ok: true,
      scripts: [{ name: "shortflare-management" }, { name: "shortflare-redirect" }],
    }),
    listWorkerBindings: async (_accountId, worker) => ({
      ok: true,
      bindings: [
        { name: "DB", type: "d1", databaseId: "database-1" },
        ...(worker === "shortflare-redirect"
          ? [{ name: "ANALYTICS_QUEUE", type: "queue", queueName: "shortflare-events" }]
          : []),
      ],
    }),
    listActiveWorkerVersions: async (_accountId, worker) => ({
      ok: true,
      versionIds: [worker === "shortflare-management" ? "management-v0" : "redirect-v0"],
    }),
    listQueues: async () => ({
      ok: true,
      queues: [
        {
          id: "queue-1",
          name: "shortflare-events",
          settings: {
            deliveryDelay: 0,
            deliveryPaused: false,
            messageRetentionPeriod: 86_400,
          },
          producers: [{ type: "worker", script: "shortflare-redirect" }],
          consumers: [
            {
              id: "consumer-1",
              type: "worker",
              scriptName: "shortflare-management",
              deadLetterQueue: "shortflare-events-dlq",
              maxRetries: 3,
              maxBatchSize: 10,
              maxBatchTimeout: 1,
              maxConcurrency: 1,
              retryDelay: 60,
            },
          ],
        },
        {
          id: "queue-2",
          name: "shortflare-events-dlq",
          settings: {
            deliveryDelay: 0,
            deliveryPaused: false,
            messageRetentionPeriod: 86_400,
          },
          producers: [],
          consumers: [],
        },
      ],
    }),
  };
}

function authorizationFailureApi(): CloudflareApi {
  return {
    listD1Databases: async () => ({
      ok: false,
      kind: "cloudflare-authorization",
      status: 403,
      retryable: false,
      resource: "/accounts/account-1/d1/database",
      requiredPermission: "Account D1 Read",
    }),
    createD1Database: async () => ({
      ok: false,
      kind: "cloudflare-authorization",
      status: 403,
      retryable: false,
    }),
    queryD1: async () => ({ ok: true, rows: [] }),
    beginD1Export: async () => ({
      ok: false,
      kind: "cloudflare-authorization",
      status: 403,
      retryable: false,
    }),
    pollD1Export: async () => ({
      ok: false,
      kind: "cloudflare-authorization",
      status: 403,
      retryable: false,
    }),
    getWorkersSubdomain: async () => ({ ok: true, registered: true, subdomain: "owner" }),
    listWorkerDomains: async () => ({ ok: true, domains: [] }),
    attachWorkerDomain: async () => ({
      ok: false,
      kind: "cloudflare-authorization",
      status: 403,
      retryable: false,
    }),
    deleteWorkerDomain: async () => ({ ok: true }),
    listWorkerSecretNames: async () => ({ ok: true, names: [] }),
    listWorkerScripts: async () => ({ ok: true, scripts: [] }),
    listWorkerBindings: async () => ({ ok: true, bindings: [] }),
    listActiveWorkerVersions: async () => ({ ok: true, versionIds: [] }),
    listQueues: async () => ({ ok: true, queues: [] }),
    createQueue: async () => ({
      ok: false,
      kind: "cloudflare-authorization",
      status: 403,
      retryable: false,
    }),
    updateQueueRetention: async () => ({
      ok: false,
      kind: "cloudflare-authorization",
      status: 403,
      retryable: false,
    }),
    deleteQueueConsumer: async () => ({ ok: true }),
  };
}

function releaseManifest() {
  return {
    formatVersion: 1 as const,
    release: "0.1.0",
    schema: {
      version: 9,
      journalSha256: "1".repeat(64),
      migrations: ["0009_famous_leo.sql"],
    },
    supportedSources: ["fresh" as const, "0.0.0"],
    rollbackSafeFrom: ["0.0.0"],
    ownership: releaseOwnershipPolicy,
    artifacts: {
      management: { path: "release/management", sha256: "2".repeat(64) },
      redirect: { path: "release/redirect", sha256: "3".repeat(64) },
      migrations: { path: "release/migrations", sha256: "4".repeat(64) },
    },
  };
}
