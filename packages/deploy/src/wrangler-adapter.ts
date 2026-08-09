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
  } as const;
}

export type WranglerAdapter = ReturnType<typeof createWranglerAdapter>;

export class WranglerCommandError extends Error {
  public constructor(stage: string) {
    super(`Wrangler ${stage} command failed`);
    this.name = "WranglerCommandError";
  }
}
