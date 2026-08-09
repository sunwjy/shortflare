import { describe, expect, it } from "vitest";

import { observeCloudflareDeployment } from "../src/cloudflare-observer";
import type { CloudflareApi } from "../src/cloudflare-api";

describe("Cloudflare deployment observer", () => {
  it("adopts only a D1 database carrying the Shortflare deployment marker", async () => {
    const api = fakeApi(async (sql) => {
      if (sql.includes("deployment_marker")) {
        return [{ instanceId: "instance-1" }];
      }
      if (sql.includes("coherent_release")) {
        return [
          {
            release: "1.0.0",
            schemaVersion: 5,
            managementWorkerVersion: "management-version-id",
            redirectWorkerVersion: "redirect-version-id",
            managementArtifactSha256: "a".repeat(64),
            redirectArtifactSha256: "b".repeat(64),
          },
        ];
      }
      if (sql.includes("d1_migrations")) {
        return [{ name: "0005_deployment_control.sql" }];
      }
      return [];
    });

    await expect(
      observeCloudflareDeployment({
        api,
        accountId: "account-1",
        targetMigrations: ["0005_deployment_control.sql", "0006_next.sql"],
      }),
    ).resolves.toMatchObject({
      kind: "present",
      databaseId: "database-1",
      instanceId: "instance-1",
      coherentRelease: "1.0.0",
      schemaVersion: 5,
      pendingMigrations: ["0006_next.sql"],
      analyticsSecret: "present",
    });
  });
});

function fakeApi(query: (sql: string) => Promise<readonly unknown[]>): CloudflareApi {
  return {
    listD1Databases: async () => ({
      ok: true,
      databases: [{ id: "database-1", name: "shortflare" }],
    }),
    createD1Database: async () => {
      throw new Error("not used");
    },
    queryD1: async (_account, _database, sql) => ({ ok: true, rows: await query(sql) }),
    beginD1Export: async () => {
      throw new Error("not used");
    },
    pollD1Export: async () => {
      throw new Error("not used");
    },
    getWorkersSubdomain: async () => ({ ok: true, registered: true, subdomain: "owner" }),
    listWorkerDomains: async () => ({ ok: true, domains: [] }),
    attachWorkerDomain: async () => {
      throw new Error("not used");
    },
    deleteWorkerDomain: async () => {
      throw new Error("not used");
    },
    listWorkerSecretNames: async () => ({ ok: true, names: ["ANALYTICS_HMAC_KEY"] }),
    listWorkerScripts: async () => ({
      ok: true,
      scripts: [{ name: "shortflare-management" }, { name: "shortflare-redirect" }],
    }),
    listWorkerBindings: async (_account, worker) => ({
      ok: true,
      bindings: [
        { name: "DB", type: "d1", databaseId: "database-1" },
        ...(worker === "shortflare-redirect"
          ? [{ name: "ANALYTICS_QUEUE", type: "queue", queueName: "shortflare-events" }]
          : []),
      ],
    }),
    listActiveWorkerVersions: async (_account, worker) => ({
      ok: true,
      versionIds: [
        worker === "shortflare-management" ? "management-version-id" : "redirect-version-id",
      ],
    }),
    listQueues: async () => ({
      ok: true,
      queues: [queue("queue-1", "shortflare-events"), queue("queue-2", "shortflare-events-dlq")],
    }),
    createQueue: async () => {
      throw new Error("not used");
    },
    updateQueueRetention: async () => {
      throw new Error("not used");
    },
    deleteQueueConsumer: async () => {
      throw new Error("not used");
    },
  };
}

function queue(id: string, name: string) {
  return {
    id,
    name,
    settings: { deliveryDelay: 0, deliveryPaused: false, messageRetentionPeriod: 86_400 },
    producers:
      name === "shortflare-events" ? [{ type: "worker", script: "shortflare-redirect" }] : [],
    consumers:
      name === "shortflare-events"
        ? [
            {
              id: "consumer-1",
              type: "worker",
              scriptName: "shortflare-management",
              deadLetterQueue: "shortflare-events-dlq",
              maxRetries: 3,
            },
          ]
        : [],
  };
}
