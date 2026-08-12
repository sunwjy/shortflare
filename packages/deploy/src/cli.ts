import {
  parseCliArguments,
  type DeployCommand,
  type DiagnoseCommand,
  type RecoverCommand,
} from "./cli-contract.js";
import { CloudflareObservationError } from "./cloudflare-observer.js";

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

export function renderCliHelp(release: string): string {
  return `Shortflare deployment CLI

Usage:
  shortflare deploy [options]
  shortflare diagnose [options]
  shortflare recover <action> [options]

Commands:
  deploy      Install, upgrade, or resume an Instance
  diagnose    Inspect an Instance without mutation
  recover     Apply an explicitly named recovery action

Documentation:
  Package README: npm view shortflare readme
  Deployment guide: https://github.com/sunwjy/shortflare/blob/v${release}/docs/deployment.md
`;
}

export async function runCli(
  arguments_: readonly string[],
  application: CliApplication,
  output: Readonly<{ stdout(text: string): void; stderr(text: string): void }>,
  runtime: Readonly<{ nodeVersion: string }> = { nodeVersion: process.versions.node },
): Promise<number> {
  if (!supportsNode(runtime.nodeVersion)) {
    output.stderr("Node.js >=22.13.0 is required to run Shortflare.\n");
    return 2;
  }

  const parsed = parseCliArguments(arguments_);
  if (!parsed.ok) {
    const result = { ok: false, formatVersion: 1, error: parsed.error };
    if (arguments_.includes("--json")) output.stdout(`${JSON.stringify(result)}\n`);
    else output.stderr(`${parsed.error.message}\n`);
    return parsed.exitCode;
  }

  let result: CliApplicationResult;
  try {
    result =
      parsed.command.kind === "deploy"
        ? await application.deploy(parsed.command)
        : parsed.command.kind === "diagnose"
          ? await application.diagnose(parsed.command)
          : await application.recover(parsed.command);
  } catch (error: unknown) {
    if (!(error instanceof CloudflareObservationError)) throw error;
    const failure = error.failure;
    result = {
      ok: false,
      exitCode: failure.kind === "cloudflare-authentication" ? 6 : 7,
      error: {
        kind: failure.kind,
        failedStage: "observation",
        retryable: failure.retryable,
        recovery: "fix-cloudflare-access",
        ...(failure.resource === undefined ? {} : { resource: failure.resource }),
        ...(failure.requiredPermission === undefined
          ? {}
          : { requiredPermission: failure.requiredPermission }),
      },
    };
  }
  if (parsed.command.mode === "json") {
    output.stdout(`${JSON.stringify(result)}\n`);
  } else {
    output.stdout(`${renderHumanResult(parsed.command.kind, result)}\n`);
  }
  return result.ok ? 0 : (result.exitCode ?? 1);
}

function supportsNode(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map((part) => Number.parseInt(part, 10));
  return major > 22 || (major === 22 && minor >= 13);
}

function renderHumanResult(
  command: "deploy" | "diagnose" | "recover",
  result: CliApplicationResult,
) {
  if (result.ok) {
    const setupToken = result.setupToken;
    if (command === "diagnose" && typeof result.observed === "object") {
      return `Shortflare diagnosis:\n${JSON.stringify(result.observed, null, 2)}`;
    }
    if (command === "deploy" && typeof result.plan === "object") {
      return `Shortflare deployment plan:\n${JSON.stringify(result.plan, null, 2)}`;
    }
    if (command === "recover" && typeof result.plan === "object") {
      return `Shortflare recovery plan:\n${JSON.stringify(result.plan, null, 2)}`;
    }
    if (command === "deploy") {
      const addresses = [
        typeof result.managementAddress === "string"
          ? `Management: ${result.managementAddress}`
          : undefined,
        typeof result.redirectAddress === "string"
          ? `Redirect: ${result.redirectAddress}`
          : undefined,
        typeof setupToken === "string" ? `One-time setup token: ${setupToken}` : undefined,
      ].filter((line): line is string => line !== undefined);
      return [`Shortflare ${command} completed.`, ...addresses].join("\n");
    }
    return `Shortflare ${command} completed.`;
  }
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
