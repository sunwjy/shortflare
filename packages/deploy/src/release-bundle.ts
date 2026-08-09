import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { ReleaseManifest } from "./release-manifest.js";

export type VerifyReleaseBundleResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      kind: "artifact-integrity-failure";
      artifact: keyof ReleaseManifest["artifacts"];
    }>;

export async function verifyReleaseBundle(
  packageRoot: string,
  manifest: ReleaseManifest,
): Promise<VerifyReleaseBundleResult> {
  const artifacts = Object.entries(manifest.artifacts) as Array<
    [keyof ReleaseManifest["artifacts"], ReleaseManifest["artifacts"]["management"]]
  >;
  const checked = await Promise.all(
    artifacts.map(async ([name, artifact]) => {
      const artifactPath = resolvePackagePath(packageRoot, artifact.path);
      const observedDigest = await hashReleaseArtifact(artifactPath).catch(() => undefined);
      return { name, matches: observedDigest === artifact.sha256 };
    }),
  );
  const failed = checked.find((artifact) => !artifact.matches);
  if (failed !== undefined) {
    return { ok: false, kind: "artifact-integrity-failure", artifact: failed.name };
  }
  return { ok: true };
}

export async function hashReleaseArtifact(artifactPath: string): Promise<string> {
  const metadata = await lstat(artifactPath);
  if (metadata.isSymbolicLink()) {
    throw new Error("Release artifacts must not contain symbolic links");
  }
  if (metadata.isFile()) {
    return createHash("sha256")
      .update(await readFile(artifactPath))
      .digest("hex");
  }
  if (!metadata.isDirectory()) {
    throw new Error("Release artifacts must be regular files or directories");
  }

  const files = await collectFiles(artifactPath);
  const digest = createHash("sha256");
  const contents = await Promise.all(
    files.map((relativePath) => readFile(path.join(artifactPath, ...relativePath.split("/")))),
  );
  files.forEach((relativePath, index) => {
    digest.update(relativePath);
    digest.update("\0");
    digest.update(contents[index] ?? new Uint8Array());
    digest.update("\0");
  });
  return digest.digest("hex");
}

async function collectFiles(root: string, relativeDirectory = ""): Promise<readonly string[]> {
  const directoryPath =
    relativeDirectory === "" ? root : path.join(root, ...relativeDirectory.split("/"));
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const collected = await Promise.all(
    entries
      .toSorted((left, right) => left.name.localeCompare(right.name, "en"))
      .map(async (entry): Promise<readonly string[]> => {
        const relativePath =
          relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
        if (entry.isSymbolicLink()) {
          throw new Error("Release artifacts must not contain symbolic links");
        }
        if (entry.isDirectory()) return collectFiles(root, relativePath);
        if (entry.isFile()) return [relativePath];
        throw new Error("Release artifacts must contain only regular files");
      }),
  );
  return collected.flat();
}

function resolvePackagePath(packageRoot: string, relativePath: string): string {
  const resolvedRoot = path.resolve(packageRoot);
  const resolvedArtifact = path.resolve(resolvedRoot, ...relativePath.split("/"));
  if (
    resolvedArtifact !== resolvedRoot &&
    !resolvedArtifact.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error("Release artifact path escapes the package root");
  }
  return resolvedArtifact;
}
