import { z } from "zod";

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
    async uploadWorker(configPath: string, versionTag: string): Promise<void> {
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
    },
    async activateWorker(configPath: string, versionTag: string): Promise<void> {
      await checkedRun([
        "versions",
        "deploy",
        "--config",
        configPath,
        "--version-tag",
        versionTag,
        "--yes",
      ]);
    },
    async putSecret(workerName: string, secretName: string, value: string): Promise<void> {
      await checkedRun(["secret", "put", secretName, "--name", workerName], { stdin: value });
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
    ): Promise<void> {
      const localArguments = [
        "--local",
        "--persist-to",
        persistenceDirectory,
        "--config",
        configPath,
      ];
      await checkedRun([
        "d1",
        "execute",
        "shortflare",
        "--file",
        backupPath,
        "--yes",
        ...localArguments,
      ]);
      await checkedRun(["d1", "migrations", "apply", "shortflare", ...localArguments]);
      const verified = await checkedRun([
        "d1",
        "execute",
        "shortflare",
        "--command",
        backupInvariantSql,
        "--json",
        ...localArguments,
      ]);
      const parsed = backupVerificationSchema.safeParse(JSON.parse(verified.stdout));
      if (!parsed.success || parsed.data[0]?.results[0]?.valid !== 1) {
        throw new WranglerCommandError("D1 backup verification");
      }
    },
  } as const;
}

const backupVerificationSchema = z.array(
  z.looseObject({
    success: z.literal(true),
    results: z.array(z.looseObject({ valid: z.number().int() })),
  }),
);

const backupInvariantSql = `SELECT CASE WHEN
  (SELECT COUNT(*) FROM deployment_marker) = 1 AND
  (SELECT COUNT(*) FROM instances) = 1 AND
  (SELECT COUNT(*) FROM users WHERE state = 'active' AND role = 'administrator') >= 1 AND
  NOT EXISTS (
    SELECT 1 FROM destination_versions d
    LEFT JOIN links l ON l.id = d.link_id WHERE l.id IS NULL
  )
THEN 1 ELSE 0 END AS valid`;

export type WranglerAdapter = ReturnType<typeof createWranglerAdapter>;

export class WranglerCommandError extends Error {
  public constructor(stage: string) {
    super(`Wrangler ${stage} command failed`);
    this.name = "WranglerCommandError";
  }
}
