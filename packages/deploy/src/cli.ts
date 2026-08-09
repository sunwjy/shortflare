import {
  parseCliArguments,
  type DeployCommand,
  type DiagnoseCommand,
  type RecoverCommand,
} from "./cli-contract.js";

export type CliApplicationResult = Readonly<{
  ok: boolean;
  exitCode?: number;
  [key: string]: unknown;
}>;

export type CliApplication = Readonly<{
  deploy(command: DeployCommand): Promise<CliApplicationResult>;
  diagnose(command: DiagnoseCommand): Promise<CliApplicationResult>;
  recover(command: RecoverCommand): Promise<CliApplicationResult>;
}>;

export async function runCli(
  arguments_: readonly string[],
  application: CliApplication,
  output: Readonly<{ stdout(text: string): void; stderr(text: string): void }>,
  runtime: Readonly<{ nodeVersion: string }> = { nodeVersion: process.versions.node },
): Promise<number> {
  if (!supportsNode(runtime.nodeVersion)) {
    output.stderr("Node.js >=22.12.0 is required to run Shortflare.\n");
    return 2;
  }

  const parsed = parseCliArguments(arguments_);
  if (!parsed.ok) {
    const result = { ok: false, formatVersion: 1, error: parsed.error };
    if (arguments_.includes("--json")) output.stdout(`${JSON.stringify(result)}\n`);
    else output.stderr(`${parsed.error.message}\n`);
    return parsed.exitCode;
  }

  const result =
    parsed.command.kind === "deploy"
      ? await application.deploy(parsed.command)
      : parsed.command.kind === "diagnose"
        ? await application.diagnose(parsed.command)
        : await application.recover(parsed.command);
  if (parsed.command.mode === "json") {
    output.stdout(`${JSON.stringify(result)}\n`);
  } else {
    output.stdout(`${renderHumanResult(parsed.command.kind, result)}\n`);
  }
  return result.ok ? 0 : (result.exitCode ?? 1);
}

function supportsNode(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map((part) => Number.parseInt(part, 10));
  return major > 22 || (major === 22 && minor >= 12);
}

function renderHumanResult(
  command: "deploy" | "diagnose" | "recover",
  result: CliApplicationResult,
) {
  if (result.ok) return `Shortflare ${command} completed.`;
  const error = result.error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return `Shortflare ${command} failed.`;
}
