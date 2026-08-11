import { describe, expect, it } from "vitest";

import { createCloudflareApi } from "../src/cloudflare-api";
import { createCloudflareDeploymentExecutor } from "../src/cloudflare-deployment-executor";
import { releaseOwnershipPolicy } from "../src/release-manifest";
import { createWranglerAdapter } from "../src/wrangler-adapter";

describe("Cloudflare Deployment Action executor", () => {
  it("waits for custom-domain publication before the first Redirect lookup", async () => {
    const delays: number[] = [];
    const api = createCloudflareApi({
      apiToken: "api-token",
      fetch: async () =>
        Response.json({
          success: true,
          errors: [],
          messages: [],
          result: [{ success: true, results: [] }],
        }),
    });
    const executor = createCloudflareDeploymentExecutor({
      api,
      wrangler: createWranglerAdapter({
        run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      }),
      accountId: "account-1",
      existingDatabaseId: "database-1",
      existingInstanceId: "instance-1",
      releaseRoot: "/unused",
      temporaryRoot: "/unused",
      backupDirectory: "/unused",
      redirectDomain: "go.example.com",
      manifest: releaseManifest(),
      now: () => new Date(1_000),
      randomBytes: () => Uint8Array.from({ length: 32 }, () => 1),
      randomId: () => "instance-1",
      fetch: async () => new Response(null, { status: 200 }),
      delay: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    await expect(
      executor.apply({ kind: "verify-worker", worker: "redirect" }, deploymentPlan()),
    ).resolves.toEqual({ ok: true });
    expect(delays).toEqual([30_000]);
  });

  it("allows a reserved Queue to be reconciled during an interrupted rerun", async () => {
    const api = createCloudflareApi({
      apiToken: "api-token",
      fetch: async () =>
        Response.json({
          success: true,
          errors: [],
          messages: [],
          result: [
            {
              queue_id: "queue-1",
              queue_name: "shortflare-events-dlq",
              settings: { delivery_delay: 0, message_retention_period: 86_400 },
            },
          ],
        }),
    });
    const executor = createCloudflareDeploymentExecutor({
      api,
      wrangler: createWranglerAdapter({
        run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      }),
      accountId: "account-1",
      existingDatabaseId: "database-1",
      existingInstanceId: "instance-1",
      releaseRoot: "/unused",
      temporaryRoot: "/unused",
      backupDirectory: "/unused",
      redirectDomain: "go.example.com",
      manifest: releaseManifest(),
      now: () => new Date(1_000),
      randomBytes: () => Uint8Array.from({ length: 32 }, () => 1),
      randomId: () => "instance-1",
      fetch: async () => new Response(null, { status: 200 }),
      delay: async () => undefined,
    });

    await expect(
      executor.revalidate(
        {
          kind: "create-queue",
          resource: "shortflare-events-dlq",
          role: "dead-letter",
        },
        deploymentPlan(),
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("creates the analytics secret once and attaches only unclaimed custom domains", async () => {
    const wranglerCalls: Array<{ arguments: readonly string[]; stdin?: string }> = [];
    const api = createCloudflareApi({
      apiToken: "api-token",
      fetch: async (input, init) => {
        const pathname = new URL(String(input)).pathname;
        const result = pathname.endsWith("/secrets")
          ? []
          : pathname.endsWith("/workers/domains") && init?.method !== "PUT"
            ? []
            : { id: "domain-1", hostname: "go.example.com", service: "shortflare-redirect" };
        return Response.json({ success: true, errors: [], messages: [], result });
      },
    });
    const wrangler = createWranglerAdapter({
      run: async (arguments_, options) => {
        wranglerCalls.push({ arguments: arguments_, ...options });
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    const executor = createCloudflareDeploymentExecutor({
      api,
      wrangler,
      accountId: "account-1",
      existingDatabaseId: "database-1",
      releaseRoot: "/unused",
      temporaryRoot: "/unused",
      backupDirectory: "/unused",
      redirectDomain: "go.example.com",
      manifest: releaseManifest(),
      now: () => new Date(1_000),
      randomBytes: () => Uint8Array.from({ length: 32 }, () => 1),
      randomId: () => "instance-1",
      fetch: async () => new Response(null, { status: 200 }),
      delay: async () => undefined,
    });

    await expect(
      executor.apply({ kind: "configure-analytics-secret" }, deploymentPlan()),
    ).resolves.toEqual({ ok: true });
    await expect(
      executor.apply(
        {
          kind: "configure-domain",
          worker: "redirect",
          domain: { kind: "custom-domain", hostname: "go.example.com" },
        },
        deploymentPlan(),
      ),
    ).resolves.toEqual({ ok: true });

    expect(wranglerCalls[0]?.arguments).toEqual([
      "versions",
      "secret",
      "put",
      "ANALYTICS_HMAC_KEY",
      "--name",
      "shortflare-redirect",
      "--tag",
      "1.0.0-redirect-secret",
    ]);
    expect(wranglerCalls[0]?.stdin).toBe("AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE");
  });

  it("rolls a failed Worker verification back when the release declares it safe", async () => {
    const wranglerCalls: string[][] = [];
    const api = createCloudflareApi({
      apiToken: "api-token",
      fetch: async (input) => {
        const pathname = new URL(String(input)).pathname;
        const result = pathname.endsWith("/query")
          ? [{ success: true, results: [{ name: "0005_deployment_control.sql" }] }]
          : pathname.endsWith("/bindings")
            ? [
                { name: "DB", type: "d1", database_id: "database-1" },
                ...(pathname.includes("shortflare-redirect")
                  ? [
                      {
                        name: "ANALYTICS_QUEUE",
                        type: "queue",
                        queue_name: "shortflare-events",
                      },
                    ]
                  : []),
              ]
            : { deployments: [{ versions: [{ version_id: "previous-management" }] }] };
        return Response.json({
          success: true,
          errors: [],
          messages: [],
          result,
        });
      },
    });
    const executor = createCloudflareDeploymentExecutor({
      api,
      wrangler: createWranglerAdapter({
        run: async (arguments_) => {
          wranglerCalls.push([...arguments_]);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
      accountId: "account-1",
      existingDatabaseId: "database-1",
      existingInstanceId: "instance-1",
      previousWorkerVersions: {
        management: "previous-management",
        redirect: "previous-redirect",
      },
      releaseRoot: "/unused",
      temporaryRoot: "/unused",
      backupDirectory: "/unused",
      redirectDomain: "go.example.com",
      managementDomain: "manage.example.com",
      manifest: { ...releaseManifest(), rollbackSafeFrom: ["0.9.0"] },
      now: () => new Date(1_000),
      randomBytes: () => Uint8Array.from({ length: 32 }, () => 1),
      randomId: () => "instance-1",
      fetch: async () => new Response(null, { status: 503 }),
      delay: async () => undefined,
    });
    const plan = { ...deploymentPlan(), operation: "upgrade" as const, sourceRelease: "0.9.0" };

    await expect(
      executor.apply({ kind: "verify-worker", worker: "management" }, plan),
    ).resolves.toMatchObject({ ok: false });
    expect(wranglerCalls).toContainEqual([
      "versions",
      "deploy",
      "--name",
      "shortflare-management",
      "--version-id",
      "previous-management",
      "--yes",
    ]);
  });

  it("restores both Workers when Redirect verification fails after Management activation", async () => {
    const wranglerCalls: string[][] = [];
    const api = createCloudflareApi({
      apiToken: "api-token",
      fetch: async (input) => {
        const pathname = new URL(String(input)).pathname;
        const worker = pathname.includes("shortflare-redirect")
          ? "previous-redirect"
          : "previous-management";
        const result = pathname.endsWith("/query")
          ? [{ success: true, results: [{ name: "0005_deployment_control.sql" }] }]
          : pathname.endsWith("/bindings")
            ? [
                { name: "DB", type: "d1", database_id: "database-1" },
                ...(pathname.includes("shortflare-redirect")
                  ? [
                      {
                        name: "ANALYTICS_QUEUE",
                        type: "queue",
                        queue_name: "shortflare-events",
                      },
                    ]
                  : []),
              ]
            : { deployments: [{ versions: [{ version_id: worker }] }] };
        return Response.json({
          success: true,
          errors: [],
          messages: [],
          result,
        });
      },
    });
    const executor = createCloudflareDeploymentExecutor({
      api,
      wrangler: createWranglerAdapter({
        run: async (arguments_) => {
          wranglerCalls.push([...arguments_]);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
      accountId: "account-1",
      existingDatabaseId: "database-1",
      existingInstanceId: "instance-1",
      previousWorkerVersions: {
        management: "previous-management",
        redirect: "previous-redirect",
      },
      releaseRoot: "/unused",
      temporaryRoot: "/unused",
      backupDirectory: "/unused",
      redirectDomain: "go.example.com",
      managementDomain: "manage.example.com",
      manifest: { ...releaseManifest(), rollbackSafeFrom: ["0.9.0"] },
      now: () => new Date(1_000),
      randomBytes: () => Uint8Array.from({ length: 32 }, () => 1),
      randomId: () => "instance-1",
      fetch: async () => new Response(null, { status: 503 }),
      delay: async () => undefined,
    });
    const plan = { ...deploymentPlan(), operation: "upgrade" as const, sourceRelease: "0.9.0" };

    await expect(
      executor.apply({ kind: "verify-worker", worker: "redirect" }, plan),
    ).resolves.toMatchObject({ ok: false });
    expect(wranglerCalls).toEqual([
      [
        "versions",
        "deploy",
        "--name",
        "shortflare-redirect",
        "--version-id",
        "previous-redirect",
        "--yes",
      ],
      [
        "versions",
        "deploy",
        "--name",
        "shortflare-management",
        "--version-id",
        "previous-management",
        "--yes",
      ],
    ]);
  });

  it("never recreates initial setup after an Administrator is active", async () => {
    let queryCount = 0;
    const api = createCloudflareApi({
      apiToken: "api-token",
      fetch: async (_input, init) => {
        queryCount += 1;
        const body: unknown = init?.body === undefined ? undefined : JSON.parse(String(init.body));
        expect(body).toMatchObject({ sql: expect.stringContaining("setup_completed_at") });
        return Response.json({
          success: true,
          errors: [],
          messages: [],
          result: [
            { success: true, results: [{ setupCompletedAt: 1_000, activeAdministrators: 1 }] },
          ],
        });
      },
    });
    const executor = createCloudflareDeploymentExecutor({
      api,
      wrangler: createWranglerAdapter({
        run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      }),
      accountId: "account-1",
      existingDatabaseId: "database-1",
      releaseRoot: "/unused",
      temporaryRoot: "/unused",
      backupDirectory: "/unused",
      redirectDomain: "go.example.com",
      manifest: releaseManifest(),
      now: () => new Date(1_000),
      randomBytes: () => Uint8Array.from({ length: 32 }, () => 1),
      randomId: () => "instance-1",
      fetch: async () => new Response(null, { status: 200 }),
      delay: async () => undefined,
    });

    await expect(
      executor.apply(
        { kind: "create-setup-handoff", administratorEmail: "owner@example.com" },
        deploymentPlan(),
      ),
    ).resolves.toEqual({ ok: true });
    expect(queryCount).toBe(1);
    expect(executor.getSetupToken()).toBeUndefined();
  });
});

function deploymentPlan() {
  return {
    operation: "install" as const,
    accountId: "account-1",
    sourceRelease: "fresh",
    targetRelease: "1.0.0",
    targetManifestDigest: "b".repeat(64),
    sourceStateDigest: "c".repeat(64),
    targetSchemaVersion: 5,
    targetArtifactDigests: {
      management: "d".repeat(64),
      redirect: "e".repeat(64),
      migrations: "f".repeat(64),
    },
    destructive: false,
    actions: [],
    digest: "a".repeat(64),
  };
}

function releaseManifest() {
  return {
    formatVersion: 1 as const,
    release: "1.0.0",
    schema: {
      version: 5,
      journalSha256: "1".repeat(64),
      migrations: ["0005_deployment_control.sql"],
    },
    supportedSources: ["fresh" as const],
    rollbackSafeFrom: [],
    ownership: releaseOwnershipPolicy,
    artifacts: {
      management: { path: "release/management", sha256: "2".repeat(64) },
      redirect: { path: "release/redirect", sha256: "3".repeat(64) },
      migrations: { path: "release/migrations", sha256: "4".repeat(64) },
    },
  };
}
