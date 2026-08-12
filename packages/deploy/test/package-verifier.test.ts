import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { assertExactPackPaths, verifyPackedPackage } from "../src/package-verifier";
import { releaseOwnershipPolicy } from "../src/release-manifest";

describe("packed npm surface", () => {
  it("rejects both unexpected and missing paths", () => {
    expect(() => assertExactPackPaths(["package.json", "secret.env"], ["package.json", "LICENSE"]))
      .toThrowErrorMatchingInlineSnapshot(`
        [Error: The npm tarball does not match pack-allowlist.json
        Unexpected: secret.env
        Missing: LICENSE]
      `);
  });

  it("verifies metadata, legal files, release identity, documentation, and paths", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shortflare-pack-verifier-"));
    const packageRoot = path.join(workspaceRoot, "packages", "deploy");
    await mkdir(path.join(packageRoot, "release"), { recursive: true });
    await Promise.all([
      writeFile(path.join(workspaceRoot, "LICENSE"), "license\n"),
      writeFile(path.join(packageRoot, "LICENSE"), "license\n"),
      writeFile(
        path.join(packageRoot, "README.md"),
        "https://github.com/sunwjy/shortflare/blob/v0.1.0/docs/deployment.md\n",
      ),
      writeFile(path.join(packageRoot, "CHANGELOG.md"), "## [0.1.0] - Unreleased\n"),
      writeFile(path.join(packageRoot, "THIRD_PARTY_NOTICES.md"), "# Third-Party Notices\n"),
      writeFile(path.join(packageRoot, "pack-allowlist.json"), '["package.json"]'),
      writeFile(path.join(packageRoot, "package.json"), JSON.stringify(validPackageJson())),
      writeFile(
        path.join(packageRoot, "release", "manifest.json"),
        JSON.stringify(validManifest()),
      ),
    ]);

    await expect(
      verifyPackedPackage({
        packageRoot,
        workspaceRoot,
        allowlistPath: path.join(packageRoot, "pack-allowlist.json"),
        runNpmPack: async () => [{ files: [{ path: "package.json" }] }],
      }),
    ).resolves.toBeUndefined();
  });
});

function validPackageJson() {
  return {
    name: "shortflare",
    version: "0.1.0",
    private: false,
    description: "An open-source URL shortener designed to run in your own Cloudflare account.",
    license: "MIT",
    repository: { type: "git", url: "git+https://github.com/sunwjy/shortflare.git" },
    homepage: "https://github.com/sunwjy/shortflare#readme",
    bugs: { url: "https://github.com/sunwjy/shortflare/issues" },
    keywords: ["url-shortener", "cloudflare", "cloudflare-workers", "self-hosted"],
    engines: { node: ">=22.12.0" },
    exports: "./dist/index.js",
    bin: { shortflare: "./dist/bin.js" },
    publishConfig: { access: "public", provenance: true },
  };
}

function validManifest() {
  return {
    formatVersion: 1,
    release: "0.1.0",
    schema: { version: 0, journalSha256: "a".repeat(64), migrations: ["0000_initial.sql"] },
    supportedSources: ["fresh"],
    rollbackSafeFrom: [],
    ownership: releaseOwnershipPolicy,
    artifacts: {
      management: { path: "release/artifacts/management", sha256: "b".repeat(64) },
      redirect: { path: "release/artifacts/redirect", sha256: "c".repeat(64) },
      migrations: { path: "release/migrations", sha256: "d".repeat(64) },
    },
  };
}
