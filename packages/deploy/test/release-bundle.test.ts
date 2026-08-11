import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { hashReleaseArtifact, verifyReleaseBundle } from "../src/release-bundle";
import { parseReleaseManifest, releaseOwnershipPolicy } from "../src/release-manifest";

describe("packed release bundle", () => {
  it("verifies every declared file and directory before observation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shortflare-release-test-"));
    await mkdir(path.join(root, "artifacts", "management"), { recursive: true });
    await mkdir(path.join(root, "artifacts", "redirect"), { recursive: true });
    await mkdir(path.join(root, "migrations"), { recursive: true });
    await writeFile(path.join(root, "artifacts", "management", "index.js"), "management");
    await writeFile(path.join(root, "artifacts", "redirect", "index.js"), "redirect");
    await writeFile(path.join(root, "migrations", "0000.sql"), "SELECT 1;");

    const manifest = parseReleaseManifest({
      formatVersion: 1,
      release: "1.0.0",
      schema: {
        version: 0,
        journalSha256: "a".repeat(64),
        migrations: ["0000_initial_schema.sql"],
      },
      supportedSources: ["fresh"],
      rollbackSafeFrom: [],
      ownership: releaseOwnershipPolicy,
      artifacts: {
        management: {
          path: "artifacts/management",
          sha256: await hashReleaseArtifact(path.join(root, "artifacts", "management")),
        },
        redirect: {
          path: "artifacts/redirect",
          sha256: await hashReleaseArtifact(path.join(root, "artifacts", "redirect")),
        },
        migrations: {
          path: "migrations",
          sha256: await hashReleaseArtifact(path.join(root, "migrations")),
        },
      },
    });
    if (!manifest.ok) throw new Error("test manifest must be valid");

    await expect(verifyReleaseBundle(root, manifest.value)).resolves.toEqual({ ok: true });
    await writeFile(path.join(root, "artifacts", "redirect", "index.js"), "tampered");
    await expect(verifyReleaseBundle(root, manifest.value)).resolves.toEqual({
      ok: false,
      kind: "artifact-integrity-failure",
      artifact: "redirect",
    });
  });

  it("hashes directory contents independently of filesystem enumeration order", async () => {
    const first = await mkdtemp(path.join(tmpdir(), "shortflare-tree-a-"));
    const second = await mkdtemp(path.join(tmpdir(), "shortflare-tree-b-"));
    await writeFile(path.join(first, "b.txt"), "b");
    await writeFile(path.join(first, "a.txt"), "a");
    await writeFile(path.join(second, "a.txt"), "a");
    await writeFile(path.join(second, "b.txt"), "b");

    await expect(hashReleaseArtifact(first)).resolves.toBe(await hashReleaseArtifact(second));
  });
});
