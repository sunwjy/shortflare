import { createHash } from "node:crypto";
import { execFile as nodeExecFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import { renderCliHelp, renderCliVersion } from "./cli.js";
import { verifyPackedPackage } from "./package-verifier.js";
import {
  assertPackedRuntimeDependencies,
  productionDependencyPolicySchema,
} from "./packed-runtime-dependencies.js";
import { verifyReleaseBundle } from "./release-bundle.js";
import { parseReleaseManifest } from "./release-manifest.js";

const execFile = promisify(nodeExecFile);
const maxBuffer = 20 * 1024 * 1024;

const packageIdentitySchema = z.object({
  name: z.literal("shortflare"),
  version: z.string().min(1),
});

const pnpmPackResultSchema = z.object({
  name: z.literal("shortflare"),
  version: z.string().min(1),
  filename: z.string().min(1),
  files: z.array(z.object({ path: z.string().min(1) }).passthrough()),
});

const checksumSchema = z.object({
  algorithm: z.literal("sha256"),
  filename: z.string().min(1),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});

export type PackedCliArtifact = Readonly<{
  tarballPath: string;
  checksumPath: string;
  version: string;
  sha256: string;
}>;

/**
 * Produces the one candidate tarball and verifies policy against its installed
 * bytes. Callers only choose where the immutable CI artifact is written.
 */
export async function produceVerifiedPackedCli(
  input: Readonly<{
    packageRoot: string;
    workspaceRoot: string;
    allowlistPath: string;
    destination: string;
  }>,
): Promise<PackedCliArtifact> {
  await mkdir(input.destination, { recursive: true });
  const packResult = await runPnpmPack(input.packageRoot, input.destination);
  await verifyPackedPackage({
    packageRoot: input.packageRoot,
    workspaceRoot: input.workspaceRoot,
    allowlistPath: input.allowlistPath,
    runNpmPack: async () => [packResult],
  });

  const tarballPath = resolveArtifactPath(input.destination, packResult.filename);
  const sha256 = await hashFile(tarballPath);
  const checksumPath = `${tarballPath}.sha256.json`;
  const tarballFilename = path.basename(tarballPath);
  await writeFile(
    checksumPath,
    `${JSON.stringify({ algorithm: "sha256", filename: tarballFilename, digest: sha256 })}\n`,
  );
  await withInstalledPackage(tarballPath, true, async ({ installedPackageRoot }) => {
    await verifyInstalledRelease(installedPackageRoot, packResult.version);
  });

  return { tarballPath, checksumPath, version: packResult.version, sha256 };
}

/**
 * Exercises the delivered artifact from an isolated npm consumer. The
 * repository is used only for the reviewed dependency policy, never for module
 * resolution by the installed CLI.
 */
export async function smokePackedCli(
  input: Readonly<{
    packageRoot: string;
    tarballPath: string;
    checksumPath: string;
  }>,
): Promise<Readonly<{ version: string; sha256: string }>> {
  const checksum = checksumSchema.parse(JSON.parse(await readFile(input.checksumPath, "utf8")));
  if (path.basename(input.tarballPath) !== checksum.filename) {
    throw new Error("The downloaded tarball filename does not match its checksum record");
  }
  const observedDigest = await hashFile(input.tarballPath);
  if (observedDigest !== checksum.digest) {
    throw new Error("The downloaded tarball does not match its producer SHA-256 digest");
  }

  const sourcePackage = packageIdentitySchema.parse(
    JSON.parse(await readFile(path.join(input.packageRoot, "package.json"), "utf8")),
  );
  const dependencyPolicy = productionDependencyPolicySchema.parse(
    JSON.parse(
      await readFile(path.join(input.packageRoot, "production-dependency-policy.json"), "utf8"),
    ),
  );

  await withInstalledPackage(
    input.tarballPath,
    false,
    async ({ consumerRoot, installedPackageRoot, environment, npmCliPath }) => {
      await verifyInstalledRelease(installedPackageRoot, sourcePackage.version);
      await verifyInstalledDependencies(
        consumerRoot,
        npmCliPath,
        environment,
        sourcePackage.version,
        dependencyPolicy,
      );
      await verifyInstalledCli(installedPackageRoot, environment, sourcePackage.version);
    },
  );

  return { version: sourcePackage.version, sha256: observedDigest };
}

export async function smokePackedCliArtifactDirectory(
  input: Readonly<{ packageRoot: string; artifactDirectory: string }>,
): Promise<Readonly<{ version: string; sha256: string }>> {
  const entries = await readdir(input.artifactDirectory);
  const tarballs = entries.filter((entry) => entry.endsWith(".tgz"));
  if (tarballs.length !== 1) {
    throw new Error("The packed CLI artifact must contain exactly one tarball");
  }
  const tarball = tarballs[0];
  if (tarball === undefined) throw new Error("The packed CLI tarball is missing");
  const checksum = `${tarball}.sha256.json`;
  if (!entries.includes(checksum)) throw new Error("The packed CLI checksum record is missing");
  const unexpected = entries.filter((entry) => entry !== tarball && entry !== checksum);
  if (unexpected.length > 0) {
    throw new Error(`The packed CLI artifact has unexpected files: ${unexpected.join(", ")}`);
  }
  return smokePackedCli({
    packageRoot: input.packageRoot,
    tarballPath: path.join(input.artifactDirectory, tarball),
    checksumPath: path.join(input.artifactDirectory, checksum),
  });
}

async function runPnpmPack(packageRoot: string, destination: string) {
  const { stdout } = await execFile("pnpm", ["pack", "--pack-destination", destination, "--json"], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
    maxBuffer,
  });
  return pnpmPackResultSchema.parse(JSON.parse(stdout));
}

async function withInstalledPackage<T>(
  tarballPath: string,
  ignoreScripts: boolean,
  operation: (
    installed: Readonly<{
      consumerRoot: string;
      installedPackageRoot: string;
      environment: NodeJS.ProcessEnv;
      npmCliPath: string;
    }>,
  ) => Promise<T>,
): Promise<T> {
  const consumerRoot = await mkdtemp(path.join(tmpdir(), "shortflare-packed-consumer-"));
  const npmCliPath = await resolveNpmCliPath();
  const environment = {
    ...process.env,
    CI: "true",
    NPM_CONFIG_CACHE: path.join(consumerRoot, "npm-cache"),
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    WRANGLER_LOG_PATH: path.join(consumerRoot, "wrangler-logs"),
  };
  try {
    await writeFile(
      path.join(consumerRoot, "package.json"),
      JSON.stringify({ name: "shortflare-packed-consumer", private: true }),
    );
    await execFile(
      process.execPath,
      [
        npmCliPath,
        "install",
        ...(ignoreScripts ? ["--ignore-scripts"] : []),
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        tarballPath,
      ],
      { cwd: consumerRoot, env: environment, encoding: "utf8", maxBuffer },
    );
    return await operation({
      consumerRoot,
      installedPackageRoot: path.join(consumerRoot, "node_modules", "shortflare"),
      environment,
      npmCliPath,
    });
  } finally {
    await rm(consumerRoot, { recursive: true, force: true });
  }
}

async function verifyInstalledRelease(installedPackageRoot: string, expectedVersion: string) {
  const installedPackage = packageIdentitySchema.parse(
    JSON.parse(await readFile(path.join(installedPackageRoot, "package.json"), "utf8")),
  );
  const manifest = parseReleaseManifest(
    JSON.parse(await readFile(path.join(installedPackageRoot, "release", "manifest.json"), "utf8")),
  );
  if (!manifest.ok) throw new Error("The packed Release manifest is invalid");
  if (installedPackage.version !== expectedVersion || manifest.value.release !== expectedVersion) {
    throw new Error("The packed package and Release manifest versions do not match the candidate");
  }
  const integrity = await verifyReleaseBundle(installedPackageRoot, manifest.value);
  if (!integrity.ok) {
    throw new Error(`The packed ${integrity.artifact} artifact does not match its digest`);
  }
}

async function verifyInstalledDependencies(
  consumerRoot: string,
  npmCliPath: string,
  environment: NodeJS.ProcessEnv,
  version: string,
  policy: z.infer<typeof productionDependencyPolicySchema>,
): Promise<void> {
  const packageNames = [
    "shortflare",
    ...new Set(policy.dependencies.flatMap((dependency) => dependency.path)),
  ];
  const { stdout } = await execFile(
    process.execPath,
    [npmCliPath, "ls", ...packageNames, "--all", "--json"],
    { cwd: consumerRoot, env: environment, encoding: "utf8", maxBuffer },
  );
  assertPackedRuntimeDependencies(JSON.parse(stdout), {
    dependencies: [{ path: ["shortflare"], version }, ...policy.dependencies],
  });
}

async function verifyInstalledCli(
  installedPackageRoot: string,
  environment: NodeJS.ProcessEnv,
  version: string,
): Promise<void> {
  const binPath = path.join(installedPackageRoot, "dist", "bin.js");
  const cliWranglerLogPath = path.join(
    path.dirname(path.dirname(installedPackageRoot)),
    "cli-wrangler-logs",
  );
  const cliEnvironment = { ...environment, WRANGLER_LOG_PATH: cliWranglerLogPath };
  const help = await execFile(process.execPath, [binPath, "--help"], {
    cwd: path.dirname(installedPackageRoot),
    env: cliEnvironment,
    encoding: "utf8",
    maxBuffer,
  });
  const versionResult = await execFile(process.execPath, [binPath, "--version"], {
    cwd: path.dirname(installedPackageRoot),
    env: cliEnvironment,
    encoding: "utf8",
    maxBuffer,
  });
  const shortVersionResult = await execFile(process.execPath, [binPath, "-v"], {
    cwd: path.dirname(installedPackageRoot),
    env: cliEnvironment,
    encoding: "utf8",
    maxBuffer,
  });
  if (help.stdout !== renderCliHelp(version) || help.stderr !== "") {
    throw new Error("The installed CLI help smoke returned unexpected output");
  }
  if (versionResult.stdout !== renderCliVersion(version) || versionResult.stderr !== "") {
    throw new Error("The installed CLI version smoke returned unexpected output");
  }
  if (shortVersionResult.stdout !== renderCliVersion(version) || shortVersionResult.stderr !== "") {
    throw new Error("The installed CLI short version smoke returned unexpected output");
  }
  await stat(cliWranglerLogPath).then(
    () => {
      throw new Error("Informational CLI commands unexpectedly started Wrangler logging");
    },
    (error: unknown) => {
      if (!isMissingPathError(error)) throw error;
    },
  );
}

async function resolveNpmCliPath(): Promise<string> {
  const executableDirectory = path.dirname(process.execPath);
  const candidates = [
    path.join(executableDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(executableDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const readableCandidates = await Promise.all(candidates.map(isReadableFile));
  const candidate = candidates.find((_, index) => readableCandidates[index]);
  if (candidate !== undefined) return candidate;
  throw new Error("Could not locate the npm CLI bundled with Node.js");
}

async function isReadableFile(filePath: string): Promise<boolean> {
  return access(filePath, constants.R_OK).then(
    () => true,
    () => false,
  );
}

function resolveArtifactPath(destination: string, filename: string): string {
  const resolvedDestination = path.resolve(destination);
  const resolvedArtifact = path.isAbsolute(filename)
    ? path.resolve(filename)
    : path.resolve(resolvedDestination, filename);
  if (
    path.dirname(resolvedArtifact) !== resolvedDestination ||
    !path.basename(resolvedArtifact).endsWith(".tgz")
  ) {
    throw new Error("pnpm returned a tarball outside the requested destination");
  }
  return resolvedArtifact;
}

async function hashFile(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
