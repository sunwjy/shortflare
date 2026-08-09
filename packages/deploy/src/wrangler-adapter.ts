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
    async deployWorker(configPath: string, customDomain?: string): Promise<void> {
      await checkedRun([
        "deploy",
        "--config",
        configPath,
        "--strict",
        "--keep-vars",
        ...(customDomain === undefined ? [] : ["--domain", customDomain]),
      ]);
    },
    async putSecret(workerName: string, secretName: string, value: string): Promise<void> {
      await checkedRun(["secret", "put", secretName, "--name", workerName], { stdin: value });
    },
  } as const;
}

export class WranglerCommandError extends Error {
  public constructor(stage: string) {
    super(`Wrangler ${stage} command failed`);
    this.name = "WranglerCommandError";
  }
}
