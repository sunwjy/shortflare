import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { writeD1Backup } from "../src/d1-backup";

describe("pre-migration D1 backup", () => {
  it("writes a verified account-scoped export with user-only permissions", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "shortflare-backup-test-"));
    const result = await writeD1Backup({
      directory,
      sourceRelease: "1.0.0",
      targetRelease: "1.1.0",
      createdAt: new Date("2026-08-09T01:02:03.456Z"),
      body: new Response("CREATE TABLE example(id TEXT);\n").body!,
    });

    expect(path.basename(result.path)).toBe("20260809T010203456Z_1.0.0_to_1.1.0.sql");
    expect(result.sha256).toBe("520605ef02cbac24f5820d1a182e6c836e865df3bebb108649d3fa816cc6ae3e");
    expect(await readFile(result.path, "utf8")).toBe("CREATE TABLE example(id TEXT);\n");
    if (process.platform !== "win32") expect((await stat(result.path)).mode & 0o777).toBe(0o600);
  });
});
