import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { smokePackedCli, smokePackedCliArtifactDirectory } from "../src/packed-cli-verifier";

describe("packed CLI verification", () => {
  it("rejects a tarball changed after the producer recorded its digest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shortflare-packed-cli-test-"));
    const tarballPath = path.join(root, "shortflare-0.1.0.tgz");
    const checksumPath = `${tarballPath}.sha256.json`;
    await Promise.all([
      writeFile(tarballPath, "changed tarball"),
      writeFile(
        checksumPath,
        JSON.stringify({
          algorithm: "sha256",
          filename: "shortflare-0.1.0.tgz",
          digest: "0".repeat(64),
        }),
      ),
    ]);

    await expect(smokePackedCli({ packageRoot: root, tarballPath, checksumPath })).rejects.toThrow(
      "does not match its producer SHA-256 digest",
    );
  });

  it("rejects extra files in the transferred artifact", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shortflare-packed-cli-test-"));
    await Promise.all([
      writeFile(path.join(root, "shortflare-0.1.0.tgz"), "tarball"),
      writeFile(path.join(root, "shortflare-0.1.0.tgz.sha256.json"), "{}"),
      writeFile(path.join(root, "unexpected.txt"), "unexpected"),
    ]);

    await expect(
      smokePackedCliArtifactDirectory({ packageRoot: root, artifactDirectory: root }),
    ).rejects.toThrow("unexpected files: unexpected.txt");
  });
});
