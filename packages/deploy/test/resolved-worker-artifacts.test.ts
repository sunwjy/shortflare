import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { prepareWorkerArtifacts } from "../src/resolved-worker-artifacts";

describe("resolved Worker artifacts", () => {
  it("copies the immutable bundle and resolves Instance bindings without changing it", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "shortflare-resolved-test-"));
    const releaseRoot = path.join(temporaryRoot, "release");
    await createReleaseFixture(releaseRoot);
    const result = await prepareWorkerArtifacts({
      releaseRoot,
      temporaryRoot: path.join(temporaryRoot, "resolved"),
      accountId: "account-1",
      databaseId: "database-1",
      redirectDomain: "go.example.com",
      rateLimitNamespaceBase: 25_000,
    });

    const management = JSON.parse(await readFile(result.managementConfig, "utf8"));
    const redirect = JSON.parse(await readFile(result.redirectConfig, "utf8"));
    expect(management.account_id).toBe("account-1");
    expect(redirect.account_id).toBe("account-1");
    expect(management.d1_databases[0]).toMatchObject({
      database_name: "shortflare",
      database_id: "database-1",
      migrations_dir: "../../../migrations",
    });
    expect(management.vars.REDIRECT_DOMAIN).toBe("go.example.com");
    expect(
      management.ratelimits.map(({ namespace_id }: { namespace_id: string }) => namespace_id),
    ).toEqual(["25000", "25001", "25002", "25003", "25004"]);
    expect(redirect.d1_databases[0].database_id).toBe("database-1");
    expect(redirect.queues.producers[0]).toEqual({
      binding: "ANALYTICS_QUEUE",
      queue: "shortflare-events",
    });
  });
});

async function createReleaseFixture(releaseRoot: string) {
  const management = path.join(releaseRoot, "artifacts", "management", "shortflare_management");
  const redirect = path.join(releaseRoot, "artifacts", "redirect", "shortflare_redirect");
  await Promise.all([mkdir(management, { recursive: true }), mkdir(redirect, { recursive: true })]);
  const d1 = [{ binding: "DB", database_name: "shortflare", database_id: "placeholder" }];
  await Promise.all([
    writeFile(
      path.join(management, "wrangler.json"),
      JSON.stringify({
        name: "shortflare-management",
        main: "index.js",
        vars: { REDIRECT_DOMAIN: "placeholder" },
        d1_databases: d1,
        ratelimits: Array.from({ length: 5 }, (_, index) => ({
          name: `LIMIT_${index}`,
          namespace_id: String(index),
        })),
      }),
    ),
    writeFile(path.join(management, "index.js"), "export default {}"),
    writeFile(
      path.join(redirect, "wrangler.json"),
      JSON.stringify({
        name: "shortflare-redirect",
        main: "index.js",
        d1_databases: d1,
        queues: { producers: [{ binding: "ANALYTICS_QUEUE", queue: "placeholder" }] },
      }),
    ),
    writeFile(path.join(redirect, "index.js"), "export default {}"),
  ]);
}
