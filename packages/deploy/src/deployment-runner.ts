import type { DeploymentAction, DeploymentPlan } from "./deployment-plan.js";

export type DeploymentApproval =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "non-destructive" }>
  | Readonly<{ kind: "plan-digest"; digest: string }>;

export type DeploymentAttemptJournal = Readonly<{
  begin(plan: DeploymentPlan): Promise<
    Readonly<{
      attemptId: string;
      completedActionIndexes: readonly number[];
    }>
  >;
  recordActionCompleted(attemptId: string, actionIndex: number): Promise<void>;
  complete(attemptId: string): Promise<void>;
  fail(attemptId: string, failure: DeploymentFailure): Promise<void>;
}>;

export type DeploymentActionExecutor = Readonly<{
  revalidate(
    action: DeploymentAction,
    plan: DeploymentPlan,
  ): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; field: string }>>;
  apply(
    action: DeploymentAction,
    plan: DeploymentPlan,
  ): Promise<
    | Readonly<{ ok: true }>
    | Readonly<{ ok: false; retryable: boolean; recovery: DeploymentRecovery }>
  >;
}>;

export type DeploymentRecovery = "approve-plan-digest" | "regenerate-plan" | "rerun-deploy";

export type DeploymentFailure = Readonly<{
  kind: "approval-required" | "deployment-drift" | "cloudflare-transient";
  stage: string;
  retryable: boolean;
  recovery: DeploymentRecovery;
}>;

export type RunDeploymentPlanResult =
  | Readonly<{
      ok: true;
      formatVersion: 1;
      attemptId: string | null;
      planDigest: string;
      sourceRelease: string;
      targetRelease: string;
      completedStages: readonly DeploymentAction["kind"][];
      finalState: "planned" | "coherent";
    }>
  | Readonly<{
      ok: false;
      formatVersion: 1;
      exitCode: 3 | 4 | 5;
      attemptId?: string;
      planDigest?: string;
      error: Readonly<{
        kind: DeploymentFailure["kind"];
        failedStage: string;
        retryable: boolean;
        recovery: DeploymentRecovery;
      }>;
    }>;

export async function runDeploymentPlan(
  input: Readonly<{
    plan: DeploymentPlan;
    approval: DeploymentApproval;
    dryRun: boolean;
    journal: DeploymentAttemptJournal;
    executor: DeploymentActionExecutor;
  }>,
): Promise<RunDeploymentPlanResult> {
  if (input.dryRun) {
    return success(input.plan, null, [], "planned");
  }

  if (!isApproved(input.plan, input.approval)) {
    return failure(4, {
      kind: "approval-required",
      stage: "approval",
      retryable: false,
      recovery: "approve-plan-digest",
    });
  }

  const attempt = await input.journal.begin(input.plan);
  const completedIndexes = new Set(attempt.completedActionIndexes);
  const failed = await runPendingActions(input, attempt.attemptId, completedIndexes);
  if (failed !== null) return failed;

  await input.journal.complete(attempt.attemptId);
  return success(
    input.plan,
    attempt.attemptId,
    input.plan.actions.map((action) => action.kind),
    "coherent",
  );
}

async function runPendingActions(
  input: Readonly<{
    plan: DeploymentPlan;
    journal: DeploymentAttemptJournal;
    executor: DeploymentActionExecutor;
  }>,
  attemptId: string,
  completedIndexes: ReadonlySet<number>,
  actionIndex = 0,
): Promise<RunDeploymentPlanResult | null> {
  const action = input.plan.actions[actionIndex];
  if (action === undefined) return null;
  if (completedIndexes.has(actionIndex)) {
    return runPendingActions(input, attemptId, completedIndexes, actionIndex + 1);
  }

  const precondition = await input.executor.revalidate(action, input.plan);
  if (!precondition.ok) {
    const deploymentFailure: DeploymentFailure = {
      kind: "deployment-drift",
      stage: action.kind,
      retryable: false,
      recovery: "regenerate-plan",
    };
    await input.journal.fail(attemptId, deploymentFailure);
    return failure(3, deploymentFailure, attemptId, input.plan.digest);
  }

  const applied = await input.executor.apply(action, input.plan);
  if (!applied.ok) {
    const deploymentFailure: DeploymentFailure = {
      kind: "cloudflare-transient",
      stage: action.kind,
      retryable: applied.retryable,
      recovery: applied.recovery,
    };
    await input.journal.fail(attemptId, deploymentFailure);
    return failure(5, deploymentFailure, attemptId, input.plan.digest);
  }

  await input.journal.recordActionCompleted(attemptId, actionIndex);
  return runPendingActions(input, attemptId, completedIndexes, actionIndex + 1);
}

function isApproved(plan: DeploymentPlan, approval: DeploymentApproval): boolean {
  if (approval.kind === "plan-digest") {
    return approval.digest === plan.digest;
  }
  return !plan.destructive && approval.kind === "non-destructive";
}

function success(
  plan: DeploymentPlan,
  attemptId: string | null,
  completedStages: readonly DeploymentAction["kind"][],
  finalState: "planned" | "coherent",
): RunDeploymentPlanResult {
  return {
    ok: true,
    formatVersion: 1,
    attemptId,
    planDigest: plan.digest,
    sourceRelease: plan.sourceRelease,
    targetRelease: plan.targetRelease,
    completedStages,
    finalState,
  };
}

function failure(
  exitCode: 3 | 4 | 5,
  deploymentFailure: DeploymentFailure,
  attemptId?: string,
  planDigest?: string,
): RunDeploymentPlanResult {
  return {
    ok: false,
    formatVersion: 1,
    exitCode,
    ...(attemptId === undefined ? {} : { attemptId }),
    ...(planDigest === undefined ? {} : { planDigest }),
    error: {
      kind: deploymentFailure.kind,
      failedStage: deploymentFailure.stage,
      retryable: deploymentFailure.retryable,
      recovery: deploymentFailure.recovery,
    },
  };
}
