import { parseArgs } from "node:util";

export type CliOutputMode = "human" | "json";

export type DeployCommand = Readonly<{
  kind: "deploy";
  mode: CliOutputMode;
  approval:
    | Readonly<{ kind: "none" }>
    | Readonly<{ kind: "non-destructive" }>
    | Readonly<{ kind: "plan-digest"; digest: string }>;
  dryRun: boolean;
  accountId?: string;
  redirectDomain?: string;
  managementDomain?: string;
  administratorEmail?: string;
  backupDirectory?: string;
  setupTokenFromStdin: boolean;
}>;

export type DiagnoseCommand = Readonly<{
  kind: "diagnose";
  mode: CliOutputMode;
  accountId?: string;
}>;

export type RecoveryAction =
  | "orphan-resources"
  | "setup-token"
  | "analytics-secret"
  | "worker-rollback";

export type RecoverCommand = Readonly<{
  kind: "recover";
  mode: CliOutputMode;
  action: RecoveryAction;
  approved: true;
  accountId?: string;
  resource?: string;
  administratorEmail?: string;
  worker?: "management" | "redirect";
  versionTag?: string;
  secretFromStdin: boolean;
}>;

export type CliCommand = DeployCommand | DiagnoseCommand | RecoverCommand;

export type ParseCliArgumentsResult =
  | Readonly<{ ok: true; command: CliCommand }>
  | Readonly<{
      ok: false;
      exitCode: 2 | 4;
      error: Readonly<{
        kind: "invalid-input" | "approval-required";
        message: string;
      }>;
    }>;

const commonOptions = {
  json: { type: "boolean" },
  "account-id": { type: "string" },
} as const;

export function parseCliArguments(arguments_: readonly string[]): ParseCliArgumentsResult {
  const [commandName, ...commandArguments] = arguments_;
  try {
    switch (commandName) {
      case "deploy":
        return parseDeploy(commandArguments);
      case "diagnose":
        return parseDiagnose(commandArguments);
      case "recover":
        return parseRecover(commandArguments);
      default:
        return invalidInput(
          commandName === undefined
            ? "A command is required: deploy, diagnose, or recover"
            : `Unknown command '${commandName}'`,
        );
    }
  } catch (error: unknown) {
    return invalidInput(normalizeParseError(error));
  }
}

function parseDeploy(arguments_: readonly string[]): ParseCliArgumentsResult {
  const parsed = parseArgs({
    args: [...arguments_],
    strict: true,
    options: {
      ...commonOptions,
      yes: { type: "boolean" },
      "dry-run": { type: "boolean" },
      "approve-digest": { type: "string" },
      "redirect-domain": { type: "string" },
      "management-domain": { type: "string" },
      "administrator-email": { type: "string" },
      "backup-dir": { type: "string" },
      "setup-token-stdin": { type: "boolean" },
    },
  });
  const mode = parsed.values.json === true ? "json" : "human";
  const dryRun = parsed.values["dry-run"] === true;

  if (parsed.values.yes === true && parsed.values["approve-digest"] !== undefined) {
    return invalidInput("Use either --yes or --approve-digest, not both");
  }
  if (
    mode === "json" &&
    !dryRun &&
    parsed.values.yes !== true &&
    parsed.values["approve-digest"] === undefined
  ) {
    return {
      ok: false,
      exitCode: 4,
      error: {
        kind: "approval-required",
        message: "JSON deployment requires --yes or --dry-run",
      },
    };
  }

  const approval =
    parsed.values["approve-digest"] !== undefined
      ? ({ kind: "plan-digest", digest: parsed.values["approve-digest"] } as const)
      : parsed.values.yes === true
        ? ({ kind: "non-destructive" } as const)
        : ({ kind: "none" } as const);

  return {
    ok: true,
    command: {
      kind: "deploy",
      mode,
      approval,
      dryRun,
      setupTokenFromStdin: parsed.values["setup-token-stdin"] === true,
      ...optional("accountId", parsed.values["account-id"]),
      ...optional("redirectDomain", parsed.values["redirect-domain"]),
      ...optional("managementDomain", parsed.values["management-domain"]),
      ...optional("administratorEmail", parsed.values["administrator-email"]),
      ...optional("backupDirectory", parsed.values["backup-dir"]),
    },
  };
}

function parseDiagnose(arguments_: readonly string[]): ParseCliArgumentsResult {
  const parsed = parseArgs({
    args: [...arguments_],
    strict: true,
    options: commonOptions,
  });
  return {
    ok: true,
    command: {
      kind: "diagnose",
      mode: parsed.values.json === true ? "json" : "human",
      ...optional("accountId", parsed.values["account-id"]),
    },
  };
}

const recoveryActions: readonly RecoveryAction[] = [
  "orphan-resources",
  "setup-token",
  "analytics-secret",
  "worker-rollback",
];

function parseRecover(arguments_: readonly string[]): ParseCliArgumentsResult {
  const parsed = parseArgs({
    args: [...arguments_],
    strict: true,
    allowPositionals: true,
    options: {
      ...commonOptions,
      yes: { type: "boolean" },
      resource: { type: "string" },
      "administrator-email": { type: "string" },
      worker: { type: "string" },
      "version-tag": { type: "string" },
      "secret-stdin": { type: "boolean" },
    },
  });
  const [action, ...extraPositionals] = parsed.positionals;
  if (action === undefined) {
    return invalidInput("recover requires a named recovery action");
  }
  if (!isRecoveryAction(action) || extraPositionals.length > 0) {
    return invalidInput(`Unknown recovery action '${action}'`);
  }
  if (parsed.values.yes !== true) {
    return {
      ok: false,
      exitCode: 4,
      error: {
        kind: "approval-required",
        message: "Recovery requires --yes after reviewing diagnosis",
      },
    };
  }
  const mode = parsed.values.json === true ? "json" : "human";
  if (action === "orphan-resources" && parsed.values.resource === undefined) {
    return invalidInput("orphan-resources requires --resource");
  }
  if (action === "setup-token" && parsed.values["administrator-email"] === undefined) {
    return invalidInput("setup-token requires --administrator-email");
  }
  if (action === "setup-token" && mode === "json" && parsed.values["secret-stdin"] !== true) {
    return invalidInput("JSON setup-token recovery requires --secret-stdin");
  }
  const worker = parsed.values.worker;
  if (
    action === "worker-rollback" &&
    ((worker !== "management" && worker !== "redirect") ||
      parsed.values["version-tag"] === undefined)
  ) {
    return invalidInput("worker-rollback requires --worker and --version-tag");
  }
  return {
    ok: true,
    command: {
      kind: "recover",
      mode,
      action,
      approved: true,
      secretFromStdin: parsed.values["secret-stdin"] === true,
      ...optional("accountId", parsed.values["account-id"]),
      ...optional("resource", parsed.values.resource),
      ...optional("administratorEmail", parsed.values["administrator-email"]),
      ...(worker === "management" || worker === "redirect" ? { worker } : {}),
      ...optional("versionTag", parsed.values["version-tag"]),
    },
  };
}

function isRecoveryAction(value: string): value is RecoveryAction {
  return recoveryActions.some((action) => action === value);
}

function optional<const Key extends string>(
  key: Key,
  value: string | undefined,
): { [P in Key]?: string } {
  return value === undefined ? {} : ({ [key]: value } as { [P in Key]: string });
}

function invalidInput(message: string): ParseCliArgumentsResult {
  return {
    ok: false,
    exitCode: 2,
    error: { kind: "invalid-input", message },
  };
}

function normalizeParseError(error: unknown): string {
  if (error instanceof Error) {
    const unknownOption = /Unknown option '([^']+)'/.exec(error.message);
    if (unknownOption?.[1] !== undefined) {
      return `Unknown option '${unknownOption[1]}'`;
    }
  }
  return "Invalid command arguments";
}
