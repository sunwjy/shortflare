import { describe, expect, it } from "vitest";

import { createWranglerAdapter } from "../src/wrangler-adapter";

describe("pinned Wrangler adapter", () => {
  it("applies remote migrations and deploys strict prebuilt Worker configs without a shell", async () => {
    const calls: Array<{ arguments: readonly string[]; stdin?: string }> = [];
    const adapter = createWranglerAdapter({
      run: async (arguments_, options) => {
        calls.push({ arguments: arguments_, ...options });
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    await adapter.applyMigrations("/bundle/management/wrangler.json");
    await adapter.deployWorker("/bundle/management/wrangler.json", "manage.example.com");

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
          "deploy",
          "--config",
          "/bundle/management/wrangler.json",
          "--strict",
          "--keep-vars",
          "--domain",
          "manage.example.com",
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
});
