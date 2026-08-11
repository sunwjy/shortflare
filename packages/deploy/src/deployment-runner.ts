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
      fencingToken: number;
    }>
  >;
  revalidateAndRenewLease(
    attemptId: string,
    fencingToken: number,
  ): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false }>>;
  recordActionCompleted(
    attemptId: string,
    actionIndex: number,
    action: DeploymentAction,
    metadata?: DeploymentActionMetadata,
  ): Promise<void>;
  complete(attemptId: string): Promise<void>;
  fail(attemptId: string, failure: DeploymentFailure): Promise<void>;
}>;

export type DeploymentActionExecutor = Readonly<{
  actionMetadata?(action: DeploymentAction): DeploymentActionMetadata | undefined;
  checkpointValid?(
    action: DeploymentAction,
    plan: DeploymentPlan,
  ): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false }>>;
  revalidate(
    action: DeploymentAction,
    plan: DeploymentPlan,
  ): Promise<
    | Readonly<{ ok: true }>
    | Readonly<{ ok: false; field: string; failure?: DeploymentCloudflareFailure }>
  >;
  apply(
    action: DeploymentAction,
    plan: DeploymentPlan,
  ): Promise<
    | Readonly<{ ok: true }>
    | Readonly<{
        ok: false;
        retryable: boolean;
        recovery: DeploymentRecovery;
        failure?: DeploymentCloudflareFailure;
      }>
  >;
}>;

export type DeploymentActionMetadata = Readonly<{
  backup?: Readonly<{ bookmark: string; path: string; sha256: string }>;
}>;

export type DeploymentRecovery =
  | "approve-plan-digest"
  | "regenerate-plan"
  | "rerun-deploy"
  | "fix-cloudflare-access";

export type DeploymentCloudflareFailure = Readonly<{
  kind: "cloudflare-authentication" | "cloudflare-authorization" | "cloudflare-transient";
  retryable: boolean;
  resource?: string;
  requiredPermission?: string;
}>;

export type DeploymentFailure = Readonly<{
  kind:
    | "approval-required"
    | "deployment-drift"
    | "lease-lost"
    | "cloudflare-transient"
    | "cloudflare-authentication"
    | "cloudflare-authorization";
  stage: string;
  retryable: boolean;
  recovery: DeploymentRecovery;
  resource?: string;
  requiredPermission?: string;
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
      exitCode: 3 | 4 | 5 | 6 | 7;
      attemptId?: string;
      planDigest?: string;
      error: Readonly<{
        kind: DeploymentFailure["kind"];
        failedStage: string;
        retryable: boolean;
        recovery: DeploymentRecovery;
        resource?: string;
        requiredPermission?: string;
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
  const failed = await runPendingActions(
    input,
    attempt.attemptId,
    attempt.fencingToken,
    completedIndexes,
  );
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
  fencingToken: number,
  completedIndexes: ReadonlySet<number>,
  actionIndex = 0,
): Promise<RunDeploymentPlanResult | null> {
  const action = input.plan.actions[actionIndex];
  if (action === undefined) return null;
  const lease = await input.journal.revalidateAndRenewLease(attemptId, fencingToken);
  if (!lease.ok) {
    const deploymentFailure: DeploymentFailure = {
      kind: "lease-lost",
      stage: action.kind,
      retryable: false,
      recovery: "regenerate-plan",
    };
    await input.journal.fail(attemptId, deploymentFailure);
    return failure(3, deploymentFailure, attemptId, input.plan.digest);
  }

  if (completedIndexes.has(actionIndex)) {
    const checkpoint = await input.executor.checkpointValid?.(action, input.plan);
    if (checkpoint?.ok === true) {
      return runPendingActions(input, attemptId, fencingToken, completedIndexes, actionIndex + 1);
    }
  }

  const precondition = await input.executor.revalidate(action, input.plan);
  if (!precondition.ok) {
    const cloudflareFailure = precondition.failure;
    const deploymentFailure: DeploymentFailure = {
      kind: cloudflareFailure?.kind ?? "deployment-drift",
      stage: action.kind,
      retryable: cloudflareFailure?.retryable ?? false,
      recovery: cloudflareFailure === undefined ? "regenerate-plan" : "rerun-deploy",
      ...(cloudflareFailure?.resource === undefined
        ? {}
        : { resource: cloudflareFailure.resource }),
      ...(cloudflareFailure?.requiredPermission === undefined
        ? {}
        : { requiredPermission: cloudflareFailure.requiredPermission }),
    };
    await input.journal.fail(attemptId, deploymentFailure);
    return failure(
      exitCodeFor(deploymentFailure.kind),
      deploymentFailure,
      attemptId,
      input.plan.digest,
    );
  }

  const applied = await input.executor.apply(action, input.plan);
  if (!applied.ok) {
    const cloudflareFailure = applied.failure;
    const deploymentFailure: DeploymentFailure = {
      kind: cloudflareFailure?.kind ?? "cloudflare-transient",
      stage: action.kind,
      retryable: applied.retryable,
      recovery: applied.recovery,
      ...(cloudflareFailure?.resource === undefined
        ? {}
        : { resource: cloudflareFailure.resource }),
      ...(cloudflareFailure?.requiredPermission === undefined
        ? {}
        : { requiredPermission: cloudflareFailure.requiredPermission }),
    };
    await input.journal.fail(attemptId, deploymentFailure);
    return failure(
      exitCodeFor(deploymentFailure.kind),
      deploymentFailure,
      attemptId,
      input.plan.digest,
    );
  }

  await input.journal.recordActionCompleted(
    attemptId,
    actionIndex,
    action,
    input.executor.actionMetadata?.(action),
  );
  return runPendingActions(input, attemptId, fencingToken, completedIndexes, actionIndex + 1);
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
  exitCode: 3 | 4 | 5 | 6 | 7,
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
      ...(deploymentFailure.resource === undefined ? {} : { resource: deploymentFailure.resource }),
      ...(deploymentFailure.requiredPermission === undefined
        ? {}
        : { requiredPermission: deploymentFailure.requiredPermission }),
    },
  };
}

function exitCodeFor(kind: DeploymentFailure["kind"]): 3 | 5 | 6 | 7 {
  if (kind === "cloudflare-authentication") return 6;
  if (kind === "cloudflare-authorization") return 7;
  if (kind === "cloudflare-transient") return 5;
  return 3;
}
