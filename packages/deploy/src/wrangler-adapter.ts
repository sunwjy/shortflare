import { z } from "zod";
import { lstat, rm } from "node:fs/promises";
import path from "node:path";

export type WranglerRun = (
  arguments_: readonly string[],
  options?: Readonly<{ stdin?: string }>,
) => Promise<Readonly<{ exitCode: number; stdout: string; stderr: string }>>;

export function createWranglerAdapter(input: Readonly<{ run: WranglerRun }>) {
  async function checkedRun(arguments_: readonly string[], options?: Readonly<{ stdin?: string }>) {
    const result = await input.run(arguments_, options);
    if (result.exitCode !== 0) throw new WranglerCommandError(arguments_[0] ?? "unknown");
    return result;
  }

  return {
    async applyMigrations(configPath: string): Promise<void> {
      await checkedRun([
        "d1",
        "migrations",
        "apply",
        "shortflare",
        "--remote",
        "--config",
        configPath,
      ]);
    },
    async uploadWorker(configPath: string, versionTag: string): Promise<string> {
      await checkedRun([
        "versions",
        "upload",
        "--config",
        configPath,
        "--strict",
        "--keep-vars",
        "--tag",
        versionTag,
      ]);
      return resolveVersionId(configPath, versionTag);
    },
    async deployNewWorker(configPath: string, versionTag: string): Promise<string> {
      await checkedRun([
        "deploy",
        "--config",
        configPath,
        "--strict",
        "--keep-vars",
        "--tag",
        versionTag,
      ]);
      return resolveVersionId(configPath, versionTag);
    },
    async activateWorker(configPath: string, versionTag: string): Promise<void> {
      const versionId = await resolveVersionId(configPath, versionTag);
      await checkedRun([
        "versions",
        "deploy",
        "--config",
        configPath,
        "--version-id",
        versionId,
        "--yes",
      ]);
    },
    async putSecret(workerName: string, secretName: string, value: string): Promise<void> {
      await checkedRun(["secret", "put", secretName, "--name", workerName], { stdin: value });
    },
    async putVersionSecret(
      workerName: string,
      secretName: string,
      value: string,
      versionTag: string,
    ): Promise<void> {
      await checkedRun(
        [
          "versions",
          "secret",
          "put",
          secretName,
          "--name",
          workerName,
          "--tag",
          `${versionTag}-secret`,
        ],
        { stdin: value },
      );
    },
    async activateWorkerTag(workerName: string, versionTag: string): Promise<void> {
      await checkedRun([
        "versions",
        "deploy",
        "--name",
        workerName,
        "--version-tag",
        versionTag,
        "--yes",
      ]);
    },
    async activateWorkerVersion(workerName: string, versionId: string): Promise<void> {
      await checkedRun([
        "versions",
        "deploy",
        "--name",
        workerName,
        "--version-id",
        versionId,
        "--yes",
      ]);
    },
    async deleteQueue(name: string): Promise<void> {
      await checkedRun(["queues", "delete", name]);
    },
    async deleteD1(name: string): Promise<void> {
      await checkedRun(["d1", "delete", name, "--skip-confirmation"]);
    },
    async deleteWorker(name: string): Promise<void> {
      await checkedRun(["delete", name]);
    },
    async verifyBackup(
      configPath: string,
      backupPath: string,
      persistenceDirectory: string,
      expected: Readonly<{ instanceId: string; sourceRelease: string }>,
    ): Promise<void> {
      const localArguments = [
        "--local",
        "--persist-to",
        persistenceDirectory,
        "--config",
        configPath,
      ];
      try {
        await checkedRun([
          "d1",
          "execute",
          "shortflare",
          "--file",
          backupPath,
          "--yes",
          ...localArguments,
        ]);
        await assertBackupInvariants(localArguments, expected, "source");
        await checkedRun(["d1", "migrations", "apply", "shortflare", ...localArguments]);
        await assertBackupInvariants(localArguments, expected, "target");
      } finally {
        await removeBackupValidationDirectory(persistenceDirectory);
      }
    },
    async resolveVersionId(configPath: string, versionTag: string): Promise<string> {
      return resolveVersionId(configPath, versionTag);
    },
    async resolveVersionIdByName(workerName: string, versionTag: string): Promise<string> {
      const listed = await checkedRun(["versions", "list", "--name", workerName, "--json"]);
      return findVersionId(listed.stdout, versionTag);
    },
  } as const;

  async function resolveVersionId(configPath: string, versionTag: string): Promise<string> {
    const listed = await checkedRun(["versions", "list", "--config", configPath, "--json"]);
    return findVersionId(listed.stdout, versionTag);
  }

  async function assertBackupInvariants(
    localArguments: readonly string[],
    expected: Readonly<{ instanceId: string; sourceRelease: string }>,
    phase: "source" | "target",
  ): Promise<void> {
    const verified = await checkedRun([
      "d1",
      "execute",
      "shortflare",
      "--command",
      backupInvariantSql(expected),
      "--json",
      ...localArguments,
    ]);
    const parsed = backupVerificationSchema.safeParse(JSON.parse(verified.stdout));
    if (!parsed.success || parsed.data[0]?.results[0]?.valid !== 1) {
      throw new WranglerCommandError(`D1 backup ${phase} verification`);
    }
  }
}

function findVersionId(output: string, versionTag: string): string {
  const parsed = z.array(workerVersionSchema).safeParse(JSON.parse(output));
  if (!parsed.success) throw new WranglerCommandError("versions list");
  const version = parsed.data.findLast(
    (candidate) =>
      candidate.tag === versionTag || candidate.annotations?.["workers/tag"] === versionTag,
  );
  if (version === undefined) throw new WranglerCommandError("version tag resolution");
  return version.id;
}

const backupVerificationSchema = z.array(
  z.looseObject({
    success: z.literal(true),
    results: z.array(z.looseObject({ valid: z.number().int() })),
  }),
);
const workerVersionSchema = z.looseObject({
  id: z.string().min(1),
  tag: z.string().optional(),
  annotations: z.record(z.string(), z.string()).optional(),
});

function backupInvariantSql(expected: Readonly<{ instanceId: string; sourceRelease: string }>) {
  const instanceId = sqlString(expected.instanceId);
  const sourceRelease = sqlString(expected.sourceRelease);
  return `SELECT CASE WHEN
  (SELECT COUNT(*) FROM deployment_marker) = 1 AND
  (SELECT instance_id FROM deployment_marker WHERE singleton_key = 1) = ${instanceId} AND
  (SELECT release FROM coherent_release WHERE singleton_key = 1) = ${sourceRelease} AND
  (SELECT COUNT(*) FROM instances) = 1 AND
  (SELECT COUNT(*) FROM users WHERE state = 'active' AND role = 'administrator') >= 1 AND
  (SELECT COUNT(*) FROM audit_events) >= 1 AND
  NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check) AND
  NOT EXISTS (
    SELECT 1 FROM destination_versions d
    LEFT JOIN links l ON l.id = d.link_id WHERE l.id IS NULL
  ) AND
  NOT EXISTS (
    SELECT 1 FROM analytics_events e
    LEFT JOIN links l ON l.id = e.link_id
    LEFT JOIN destination_versions d ON d.id = e.destination_version_id
    WHERE l.id IS NULL OR d.id IS NULL OR d.link_id <> e.link_id
  ) AND
  NOT EXISTS (
    SELECT 1 FROM analytics_uniques u
    LEFT JOIN links l ON l.id = u.link_id
    LEFT JOIN destination_versions d ON d.id = u.destination_version_id
    WHERE l.id IS NULL OR (u.destination_version_id IS NOT NULL AND d.id IS NULL)
  ) AND
  NOT EXISTS (
    SELECT 1 FROM analytics_rollups r
    LEFT JOIN links l ON l.id = r.link_id
    LEFT JOIN destination_versions d ON d.id = r.destination_version_id
    WHERE l.id IS NULL OR (r.destination_version_id IS NOT NULL AND d.id IS NULL)
       OR r.human_clicks < 0 OR r.unique_human_clicks < 0 OR r.suspected_bot_clicks < 0
  )
THEN 1 ELSE 0 END AS valid`;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function removeBackupValidationDirectory(directory: string): Promise<void> {
  const resolved = path.resolve(directory);
  if (!path.basename(resolved).endsWith("-backup-validation")) {
    throw new WranglerCommandError("unsafe backup validation cleanup target");
  }
  const status = await lstat(resolved).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (status === undefined) return;
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new WranglerCommandError("unsafe backup validation cleanup target");
  }
  await rm(resolved, { recursive: true });
}

export type WranglerAdapter = ReturnType<typeof createWranglerAdapter>;

export class WranglerCommandError extends Error {
  public constructor(stage: string) {
    super(`Wrangler ${stage} command failed`);
    this.name = "WranglerCommandError";
  }
}
