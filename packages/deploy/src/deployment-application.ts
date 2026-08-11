import type { CliApplication, CliApplicationResult } from "./cli.js";
import type { DeployCommand } from "./cli-contract.js";
import type { RecoverCommand } from "./cli-contract.js";
import {
  createDeploymentPlan,
  observedStateDigest,
  type DeploymentPlan,
  type ObservedDeploymentState,
} from "./deployment-plan.js";
import {
  runDeploymentPlan,
  type DeploymentActionExecutor,
  type DeploymentAttemptJournal,
} from "./deployment-runner.js";
import type { ReleaseManifest } from "./release-manifest.js";

type ApplicationExecutor = DeploymentActionExecutor &
  Readonly<{
    getDatabaseId(): string | undefined;
    getInstanceId?(): string | undefined;
    getSetupToken?(): string | undefined;
    getManagementAddress?(): string | undefined;
    getRedirectAddress?(): string | undefined;
    getBackup?(): Readonly<{ path: string; sha256: string; bookmark: string }> | undefined;
  }>;

export function createDeploymentApplication(
  input: Readonly<{
    manifest: ReleaseManifest;
    observe(
      accountId: string,
      domains?: Readonly<{ redirectDomain: string; managementDomain?: string }>,
    ): Promise<ObservedDeploymentState>;
    createExecutor(
      observed: ObservedDeploymentState,
      request: Readonly<{
        redirectDomain: string;
        managementDomain?: string;
        backupDirectory?: string;
        mode: "human" | "json";
        setupTokenFromStdin: boolean;
      }>,
    ): ApplicationExecutor;
    createJournal(databaseId: string, accountId: string): DeploymentAttemptJournal;
    writeConfig(
      result: Readonly<{
        accountId: string;
        databaseId: string;
        instanceId?: string;
        redirectDomain: string;
        managementDomain?: string;
        release: string;
      }>,
    ): Promise<void>;
    approvePlan?(plan: DeploymentPlan): Promise<boolean>;
    requestAdministratorEmail?(observed: ObservedDeploymentState): Promise<string | undefined>;
    diagnose?(accountId: string): Promise<CliApplicationResult>;
    recover?(accountId: string, command: RecoverCommand): Promise<CliApplicationResult>;
  }>,
): CliApplication {
  return {
    async deploy(command) {
      const required = validateDeployCommand(command);
      if (!required.ok) return required.result;
      const observed = await input.observe(required.accountId, {
        redirectDomain: required.redirectDomain,
        ...(command.managementDomain === undefined
          ? {}
          : { managementDomain: command.managementDomain }),
      });
      const managementDomain =
        command.managementDomain ??
        (observed.kind === "present" ? observed.domains?.management : undefined);
      const needsAdministratorEmail =
        observed.kind === "absent" ||
        observed.coherentRelease === "fresh" ||
        observed.initialSetup === "required";
      const administratorEmail =
        command.administratorEmail ??
        (needsAdministratorEmail ? await input.requestAdministratorEmail?.(observed) : undefined);
      const planned = createDeploymentPlan({
        target: input.manifest,
        observed,
        requested: {
          redirectDomain: required.redirectDomain,
          ...(administratorEmail === undefined ? {} : { administratorEmail }),
          ...(managementDomain === undefined ? {} : { managementDomain }),
        },
      });
      if (!planned.ok) return { ok: false, exitCode: 3, error: planned };
      if (command.dryRun) {
        return { ok: true, formatVersion: 1, finalState: "planned", plan: planned.plan };
      }
      if (
        command.mode === "json" &&
        !command.setupTokenFromStdin &&
        planned.plan.actions.some((action) => action.kind === "create-setup-handoff")
      ) {
        return invalidInput("Initial installation in JSON mode requires --setup-token-stdin");
      }
      const approval = await resolveApproval(planned.plan, command, input.approvePlan);
      if (approval === undefined) {
        return {
          ok: false,
          exitCode: 4,
          error: {
            kind: "approval-required",
            message: `Approve plan ${planned.plan.digest} with --yes or --approve-digest`,
          },
        };
      }

      // Approval is bound to the observed source state. Re-observe immediately
      // before mutation so account drift during an interactive review invalidates
      // the approved plan instead of applying stale effects (ADR-0030).
      const current = await input.observe(required.accountId, {
        redirectDomain: required.redirectDomain,
        ...(managementDomain === undefined ? {} : { managementDomain }),
      });
      if (observedStateDigest(current) !== planned.plan.sourceStateDigest) {
        return {
          ok: false,
          exitCode: 3,
          error: {
            kind: "deployment-drift",
            failedStage: "source-state",
            retryable: false,
            recovery: "regenerate-plan",
          },
        };
      }

      const executor = input.createExecutor(observed, {
        redirectDomain: required.redirectDomain,
        ...(managementDomain === undefined ? {} : { managementDomain }),
        ...(command.backupDirectory === undefined
          ? {}
          : { backupDirectory: command.backupDirectory }),
        mode: command.mode,
        setupTokenFromStdin: command.setupTokenFromStdin,
      });
      const bootstrapped = await bootstrapFreshInstance(planned.plan, executor);
      if (!bootstrapped.ok) return bootstrapped.result;
      const databaseId = executor.getDatabaseId();
      if (databaseId === undefined) {
        return invalidState("Deployment did not resolve a D1 database");
      }
      const journal = withBootstrapCompletion(
        input.createJournal(databaseId, required.accountId),
        bootstrapped.completedActionIndexes,
      );
      const result = await runDeploymentPlan({
        plan: planned.plan,
        approval,
        dryRun: false,
        journal,
        executor,
      });
      if (result.ok) {
        const instanceId = executor.getInstanceId?.();
        await input.writeConfig({
          accountId: required.accountId,
          databaseId,
          ...(instanceId === undefined ? {} : { instanceId }),
          redirectDomain: required.redirectDomain,
          ...(managementDomain === undefined ? {} : { managementDomain }),
          release: planned.plan.targetRelease,
        });
      }
      const newSetupToken = command.mode === "human" ? executor.getSetupToken?.() : undefined;
      if (!result.ok) return result;
      const managementAddress = executor.getManagementAddress?.();
      const redirectAddress = executor.getRedirectAddress?.();
      const backup = executor.getBackup?.();
      return {
        ...result,
        ...(newSetupToken === undefined ? {} : { setupToken: newSetupToken }),
        ...(managementAddress === undefined ? {} : { managementAddress }),
        ...(redirectAddress === undefined ? {} : { redirectAddress }),
        ...(backup === undefined ? {} : { backup }),
      };
    },

    async diagnose(command) {
      const accountId = command.accountId;
      if (accountId === undefined) return invalidInput("--account-id is required");
      if (input.diagnose !== undefined) return input.diagnose(accountId);
      const observed = await input.observe(accountId);
      return { ok: true, formatVersion: 1, observed };
    },

    async recover(command) {
      const accountId = command.accountId;
      if (accountId === undefined) return invalidInput("--account-id is required");
      if (input.recover === undefined) {
        return invalidInput(`Recovery action '${command.action}' is not available`);
      }
      return input.recover(accountId, command);
    },
  };
}

function validateDeployCommand(
  command: DeployCommand,
):
  | Readonly<{ ok: true; accountId: string; redirectDomain: string }>
  | Readonly<{ ok: false; result: CliApplicationResult }> {
  if (command.accountId === undefined) {
    return { ok: false, result: invalidInput("--account-id is required") };
  }
  if (command.redirectDomain === undefined) {
    return { ok: false, result: invalidInput("--redirect-domain is required") };
  }
  return {
    ok: true,
    accountId: command.accountId,
    redirectDomain: command.redirectDomain,
  };
}

async function resolveApproval(
  plan: DeploymentPlan,
  command: DeployCommand,
  approvePlan: ((plan: DeploymentPlan) => Promise<boolean>) | undefined,
) {
  if (command.approval.kind === "plan-digest") {
    return command.approval.digest === plan.digest ? command.approval : undefined;
  }
  if (!plan.destructive && command.approval.kind === "non-destructive") return command.approval;
  if (command.mode === "human" && approvePlan !== undefined && (await approvePlan(plan))) {
    return { kind: "plan-digest", digest: plan.digest } as const;
  }
  return undefined;
}

async function bootstrapFreshInstance(
  plan: DeploymentPlan,
  executor: ApplicationExecutor,
): Promise<
  | Readonly<{ ok: true; completedActionIndexes: readonly number[] }>
  | Readonly<{ ok: false; result: CliApplicationResult }>
> {
  if (plan.operation !== "install" || plan.actions[0]?.kind !== "create-d1") {
    return { ok: true, completedActionIndexes: [] };
  }
  return applyBootstrapAction(plan, executor, 0, []);
}

async function applyBootstrapAction(
  plan: DeploymentPlan,
  executor: ApplicationExecutor,
  index: number,
  completed: readonly number[],
): Promise<
  | Readonly<{ ok: true; completedActionIndexes: readonly number[] }>
  | Readonly<{ ok: false; result: CliApplicationResult }>
> {
  // D1 and its immutable marker bootstrap identity; the marker action also creates the
  // Deployment Control journal so every subsequent effect, including migrations, is leased.
  if (index >= 2) return { ok: true, completedActionIndexes: completed };
  const action = plan.actions[index];
  if (action === undefined) {
    return {
      ok: false,
      result: invalidState("Fresh deployment bootstrap plan is incomplete"),
    };
  }
  const precondition = await executor.revalidate(action, plan);
  if (!precondition.ok) {
    return {
      ok: false,
      result: invalidState(`Deployment drift at ${precondition.field}`),
    };
  }
  const applied = await executor.apply(action, plan);
  if (!applied.ok) {
    return {
      ok: false,
      result: {
        ok: false,
        exitCode: 5,
        error: {
          kind: "cloudflare-transient",
          failedStage: action.kind,
          retryable: applied.retryable,
          recovery: applied.recovery,
        },
      },
    };
  }
  return applyBootstrapAction(plan, executor, index + 1, [...completed, index]);
}

function withBootstrapCompletion(
  journal: DeploymentAttemptJournal,
  completedActionIndexes: readonly number[],
): DeploymentAttemptJournal {
  if (completedActionIndexes.length === 0) return journal;
  return {
    ...journal,
    async begin(plan) {
      const attempt = await journal.begin(plan);
      return {
        ...attempt,
        completedActionIndexes: [
          ...new Set([...completedActionIndexes, ...attempt.completedActionIndexes]),
        ],
      };
    },
  };
}

function invalidInput(message: string): CliApplicationResult {
  return { ok: false, exitCode: 2, error: { kind: "invalid-input", message } };
}

function invalidState(message: string): CliApplicationResult {
  return { ok: false, exitCode: 3, error: { kind: "deployment-drift", message } };
}
