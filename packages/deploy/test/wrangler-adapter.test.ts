import { describe, expect, it } from "vitest";

import { createWranglerAdapter } from "../src/wrangler-adapter";

describe("pinned Wrangler adapter", () => {
  it("applies remote migrations and deploys strict prebuilt Worker configs without a shell", async () => {
    const calls: Array<{ arguments: readonly string[]; stdin?: string }> = [];
    const adapter = createWranglerAdapter({
      run: async (arguments_, options) => {
        calls.push({ arguments: arguments_, ...options });
        return {
          exitCode: 0,
          stdout: arguments_.includes("list")
            ? JSON.stringify([{ id: "management-version-id", tag: "1.0.0-management" }])
            : "",
          stderr: "",
        };
      },
    });

    await adapter.applyMigrations("/bundle/management/wrangler.json");
    await adapter.uploadWorker("/bundle/management/wrangler.json", "1.0.0-management");
    await adapter.activateWorker("/bundle/management/wrangler.json", "1.0.0-management");

    expect(calls).toEqual([
      {
        arguments: [
          "d1",
          "migrations",
          "apply",
          "shortflare",
          "--remote",
          "--config",
          "/bundle/management/wrangler.json",
        ],
      },
      {
        arguments: [
          "versions",
          "upload",
          "--config",
          "/bundle/management/wrangler.json",
          "--strict",
          "--keep-vars",
          "--tag",
          "1.0.0-management",
        ],
      },
      {
        arguments: ["versions", "list", "--config", "/bundle/management/wrangler.json", "--json"],
      },
      {
        arguments: [
          "versions",
          "deploy",
          "--config",
          "/bundle/management/wrangler.json",
          "--version-tag",
          "1.0.0-management",
          "--yes",
        ],
      },
    ]);
  });

  it("passes generated secrets only through stdin", async () => {
    const calls: Array<{ arguments: readonly string[]; stdin?: string }> = [];
    const adapter = createWranglerAdapter({
      run: async (arguments_, options) => {
        calls.push({ arguments: arguments_, ...options });
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    await adapter.putSecret("shortflare-redirect", "ANALYTICS_HMAC_KEY", "secret-value");

    expect(calls).toEqual([
      {
        arguments: ["secret", "put", "ANALYTICS_HMAC_KEY", "--name", "shortflare-redirect"],
        stdin: "secret-value",
      },
    ]);
    expect(JSON.stringify(calls[0]?.arguments)).not.toContain("secret-value");
  });

  it("imports and validates an upgrade backup in isolated local D1", async () => {
    const calls: string[][] = [];
    const adapter = createWranglerAdapter({
      run: async (arguments_) => {
        calls.push([...arguments_]);
        return {
          exitCode: 0,
          stdout: arguments_.includes("--json")
            ? JSON.stringify([{ success: true, results: [{ valid: 1 }] }])
            : "",
          stderr: "",
        };
      },
    });

    await expect(
      adapter.verifyBackup(
        "/resolved/wrangler.json",
        "/backups/upgrade.sql",
        "/temporary/local-d1",
      ),
    ).resolves.toBeUndefined();
    expect(calls[0]).toContain("--file");
    expect(calls[1]).toContain("migrations");
    expect(calls[2]).toContain("--json");
  });
});
