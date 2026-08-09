import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { assembleReleaseBundle } from "../src/assemble-release";
import { verifyReleaseBundle } from "../src/release-bundle";

describe("release assembly", () => {
  it("copies prebuilt Workers and forward migrations into a verified package bundle", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shortflare-assembly-test-"));
    const packageRoot = path.join(root, "package");
    const managementBuild = path.join(root, "management");
    const redirectBuild = path.join(root, "redirect");
    const migrationsDirectory = path.join(root, "migrations");
    await Promise.all([
      mkdir(packageRoot, { recursive: true }),
      mkdir(managementBuild, { recursive: true }),
      mkdir(redirectBuild, { recursive: true }),
      mkdir(migrationsDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(packageRoot, "package.json"), '{"name":"shortflare"}'),
      writeFile(path.join(managementBuild, "index.js"), "management"),
      writeFile(path.join(redirectBuild, "index.js"), "redirect"),
      writeFile(path.join(migrationsDirectory, "0000_initial.sql"), "SELECT 1;"),
      writeFile(path.join(migrationsDirectory, "notes.md"), "not packaged"),
    ]);

    const manifest = await assembleReleaseBundle({
      packageRoot,
      managementBuild,
      redirectBuild,
      migrationsDirectory,
      release: "1.0.0",
    });

    await expect(verifyReleaseBundle(packageRoot, manifest)).resolves.toEqual({ ok: true });
    await expect(
      readFile(path.join(packageRoot, "release", "migrations", "notes.md")),
    ).rejects.toThrow();
    expect(
      JSON.parse(await readFile(path.join(packageRoot, "release", "manifest.json"), "utf8")),
    ).toEqual(manifest);
  });
});
