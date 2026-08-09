import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hashReleaseArtifact } from "./release-bundle.js";
import { parseReleaseManifest, type ReleaseManifest } from "./release-manifest.js";

export async function assembleReleaseBundle(
  input: Readonly<{
    packageRoot: string;
    managementBuild: string;
    redirectBuild: string;
    migrationsDirectory: string;
    release: string;
  }>,
): Promise<ReleaseManifest> {
  const releaseRoot = path.join(input.packageRoot, "release");
  await assertDeployPackage(input.packageRoot);
  await rm(releaseRoot, { recursive: true, force: true });

  const managementDestination = path.join(releaseRoot, "artifacts", "management");
  const redirectDestination = path.join(releaseRoot, "artifacts", "redirect");
  const migrationsDestination = path.join(releaseRoot, "migrations");
  await Promise.all([
    copyDirectory(input.managementBuild, managementDestination),
    copyDirectory(input.redirectBuild, redirectDestination),
    copyMigrations(input.migrationsDirectory, migrationsDestination),
  ]);

  const [managementSha256, redirectSha256, journalSha256] = await Promise.all([
    hashReleaseArtifact(managementDestination),
    hashReleaseArtifact(redirectDestination),
    hashReleaseArtifact(migrationsDestination),
  ]);
  const migrationNames = (await readdir(migrationsDestination)).filter((name) =>
    name.endsWith(".sql"),
  );
  const schemaVersion = Math.max(
    ...migrationNames.map((name) => Number.parseInt(name.slice(0, 4), 10)),
  );
  const manifestInput = {
    formatVersion: 1,
    release: input.release,
    schema: { version: schemaVersion, journalSha256, migrations: migrationNames.toSorted() },
    supportedSources: ["fresh"],
    rollbackSafeFrom: [],
    artifacts: {
      management: { path: "release/artifacts/management", sha256: managementSha256 },
      redirect: { path: "release/artifacts/redirect", sha256: redirectSha256 },
      migrations: { path: "release/migrations", sha256: journalSha256 },
    },
  };
  const parsed = parseReleaseManifest(manifestInput);
  if (!parsed.ok) throw new Error("Generated release manifest is invalid");
  await writeFile(
    path.join(releaseRoot, "manifest.json"),
    `${JSON.stringify(parsed.value, null, 2)}\n`,
    { mode: 0o644 },
  );
  return parsed.value;
}

async function assertDeployPackage(packageRoot: string): Promise<void> {
  const packageJson = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  ) as {
    name?: unknown;
  };
  if (packageJson.name !== "shortflare") {
    throw new Error("Refusing to assemble release outside the shortflare package");
  }
}

async function copyDirectory(source: string, destination: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
}

async function copyMigrations(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  const migrationNames = (await readdir(source))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .toSorted();
  if (migrationNames.length === 0) throw new Error("No release migrations were found");
  await Promise.all(
    migrationNames.map((name) => cp(path.join(source, name), path.join(destination, name))),
  );
}

async function assembleWorkspaceRelease(): Promise<void> {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const workspaceRoot = path.resolve(packageRoot, "../..");
  const packageJson = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  ) as {
    version?: unknown;
  };
  if (typeof packageJson.version !== "string") throw new Error("Package version is missing");
  await assembleReleaseBundle({
    packageRoot,
    managementBuild: path.join(workspaceRoot, "apps", "management", "dist"),
    redirectBuild: path.join(workspaceRoot, "apps", "redirect-worker", "dist"),
    migrationsDirectory: path.join(workspaceRoot, "packages", "database", "drizzle", "migrations"),
    release: packageJson.version,
  });
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await assembleWorkspaceRelease();
}
