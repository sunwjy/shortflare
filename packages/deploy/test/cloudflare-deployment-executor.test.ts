import { describe, expect, it } from "vitest";

import { createCloudflareApi } from "../src/cloudflare-api";
import { createCloudflareDeploymentExecutor } from "../src/cloudflare-deployment-executor";
import { createWranglerAdapter } from "../src/wrangler-adapter";

describe("Cloudflare Deployment Action executor", () => {
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
      "secret",
      "put",
      "ANALYTICS_HMAC_KEY",
      "--name",
      "shortflare-redirect",
    ]);
    expect(wranglerCalls[0]?.stdin).toBe("AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE");
  });
});

function deploymentPlan() {
  return {
    operation: "install" as const,
    accountId: "account-1",
    sourceRelease: "fresh",
    targetRelease: "1.0.0",
    targetManifestDigest: "b".repeat(64),
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
    artifacts: {
      management: { path: "release/management", sha256: "2".repeat(64) },
      redirect: { path: "release/redirect", sha256: "3".repeat(64) },
      migrations: { path: "release/migrations", sha256: "4".repeat(64) },
    },
  };
}
