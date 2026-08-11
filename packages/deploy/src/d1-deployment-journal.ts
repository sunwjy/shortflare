import { z } from "zod";

import type { DeploymentAttemptJournal, DeploymentFailure } from "./deployment-runner.js";
import type { DeploymentAction, DeploymentPlan } from "./deployment-plan.js";

export type D1DeploymentQuery = (
  sql: string,
  parameters: readonly (string | null)[],
) => Promise<readonly unknown[]>;

export class DeploymentLeaseConflictError extends Error {
  public constructor() {
    super("Another Deployment Attempt holds the active lease");
    this.name = "DeploymentLeaseConflictError";
  }
}

const attemptRowSchema = z.looseObject({
  id: z.string().min(1),
  completedActions: z.string(),
});
const leaseRowSchema = z.looseObject({ fencingToken: z.number().int().positive() });
const tableColumnSchema = z.looseObject({ name: z.string() });

export function createD1DeploymentJournal(
  input: Readonly<{
    query: D1DeploymentQuery;
    now: () => Date;
    randomId: () => string;
    leaseDurationMs?: number;
  }>,
): DeploymentAttemptJournal {
  const leaseDurationMs = input.leaseDurationMs ?? 60_000;
  const activePlans = new Map<string, DeploymentPlan>();

  return {
    async begin(plan) {
      const now = input.now().getTime();
      const hasDetailedJournal = await hasDetailedAttemptJournal(input);
      const existingRows = await input.query(
        `SELECT id, completed_actions AS completedActions
         FROM deployment_attempts
         WHERE plan_digest = ? AND status = 'running'
         ORDER BY updated_at DESC LIMIT 1`,
        [plan.digest],
      );
      const existing = attemptRowSchema.safeParse(existingRows[0]);
      const attemptId = existing.success ? existing.data.id : input.randomId();
      const sealedRows = existing.success
        ? []
        : await input.query(
            `SELECT id, completed_actions AS completedActions
             FROM deployment_attempts
             WHERE plan_digest = ? AND status = 'failed'
             ORDER BY updated_at DESC LIMIT 1`,
            [plan.digest],
          );
      const sealed = attemptRowSchema.safeParse(sealedRows[0]);
      const completedActionIndexes = parseCompletedActions(
        existing.success
          ? existing.data.completedActions
          : sealed.success
            ? sealed.data.completedActions
            : "[]",
      );

      if (existing.success) {
        await input.query(
          `UPDATE deployment_attempts
           SET status = 'running', failure_kind = NULL, failed_stage = NULL, updated_at = ?
           WHERE id = ?`,
          [String(now), attemptId],
        );
      } else {
        await insertAttempt(
          input,
          plan,
          attemptId,
          completedActionIndexes,
          now,
          hasDetailedJournal,
        );
      }

      const leaseRows = await input.query(
        `INSERT INTO deployment_lease
           (singleton_key, attempt_id, expires_at, fencing_token)
         VALUES (1, ?, ?, 1)
         ON CONFLICT(singleton_key) DO UPDATE SET
           attempt_id = excluded.attempt_id,
           expires_at = excluded.expires_at,
           fencing_token = deployment_lease.fencing_token + 1
         WHERE deployment_lease.expires_at <= ? OR deployment_lease.attempt_id = excluded.attempt_id
         RETURNING fencing_token AS fencingToken`,
        [attemptId, String(now + leaseDurationMs), String(now)],
      );
      const lease = leaseRowSchema.safeParse(leaseRows[0]);
      if (!lease.success) throw new DeploymentLeaseConflictError();
      activePlans.set(attemptId, plan);
      return { attemptId, completedActionIndexes, fencingToken: lease.data.fencingToken };
    },

    async revalidateAndRenewLease(attemptId, fencingToken) {
      const now = input.now().getTime();
      const rows = await input.query(
        `UPDATE deployment_lease SET expires_at = ?
         WHERE singleton_key = 1 AND attempt_id = ? AND fencing_token = ? AND expires_at > ?
         RETURNING fencing_token AS fencingToken`,
        [String(now + leaseDurationMs), attemptId, String(fencingToken), String(now)],
      );
      return leaseRowSchema.safeParse(rows[0]).success ? { ok: true } : { ok: false };
    },

    async recordActionCompleted(attemptId, actionIndex, action, metadata) {
      const now = String(input.now().getTime());
      const plan = activePlans.get(attemptId);
      if (plan === undefined) throw new Error("Deployment Attempt plan identity is unavailable");
      if (!(await hasDetailedAttemptJournal(input))) {
        await input.query(
          `UPDATE deployment_attempts
           SET completed_actions = json_insert(completed_actions, '$[#]', json(?)), updated_at = ?
           WHERE id = ? AND status = 'running'`,
          [String(actionIndex), now, attemptId],
        );
        return;
      }
      await input.query(
        `UPDATE deployment_attempts
         SET completed_actions = json_insert(completed_actions, '$[#]', json(?)),
             stage_outcomes = json_insert(stage_outcomes, '$[#]', json(?)),
             backup_bookmark = COALESCE(NULLIF(?, ''), backup_bookmark),
             backup_path = COALESCE(NULLIF(?, ''), backup_path),
             backup_sha256 = COALESCE(NULLIF(?, ''), backup_sha256),
             recovery_action = COALESCE(NULLIF(?, ''), recovery_action),
             target_manifest_digest = ?,
             source_state_digest = ?,
             target_schema_version = ?,
             target_artifact_digests = ?,
             updated_at = ?
         WHERE id = ? AND status = 'running'`,
        [
          String(actionIndex),
          JSON.stringify({ index: actionIndex, stage: action.kind, completedAt: Number(now) }),
          metadata?.backup?.bookmark ?? "",
          metadata?.backup?.path ?? "",
          metadata?.backup?.sha256 ?? "",
          action.kind === "recover" ? action.action : "",
          plan.targetManifestDigest,
          plan.sourceStateDigest,
          String(plan.targetSchemaVersion),
          JSON.stringify(plan.targetArtifactDigests),
          now,
          attemptId,
        ],
      );
    },

    async complete(attemptId) {
      await input.query(
        `UPDATE deployment_attempts SET status = 'coherent', updated_at = ? WHERE id = ?`,
        [String(input.now().getTime()), attemptId],
      );
      await input.query("DELETE FROM deployment_lease WHERE singleton_key = 1 AND attempt_id = ?", [
        attemptId,
      ]);
      activePlans.delete(attemptId);
    },

    async fail(attemptId, failure) {
      await recordFailure(input, attemptId, failure);
      await input.query("DELETE FROM deployment_lease WHERE singleton_key = 1 AND attempt_id = ?", [
        attemptId,
      ]);
      activePlans.delete(attemptId);
    },
  };
}

async function hasDetailedAttemptJournal(
  input: Readonly<{ query: D1DeploymentQuery }>,
): Promise<boolean> {
  const columns = await deploymentAttemptColumns(input);
  return columns.has("stage_outcomes");
}

async function deploymentAttemptColumns(
  input: Readonly<{ query: D1DeploymentQuery }>,
): Promise<ReadonlySet<string>> {
  const rows = await input.query("PRAGMA table_info(deployment_attempts)", []);
  return new Set(
    rows.flatMap((row) => {
      const parsed = tableColumnSchema.safeParse(row);
      return parsed.success ? [parsed.data.name] : [];
    }),
  );
}

async function insertAttempt(
  input: Readonly<{ query: D1DeploymentQuery }>,
  plan: DeploymentPlan,
  attemptId: string,
  completedActionIndexes: readonly number[],
  now: number,
  detailed: boolean,
): Promise<void> {
  if (!detailed) {
    await input.query(
      `INSERT INTO deployment_attempts
         (id, plan_digest, source_release, target_release, status,
          completed_actions, started_at, updated_at)
       VALUES (?, ?, ?, ?, 'running', ?, ?, ?)`,
      [
        attemptId,
        plan.digest,
        plan.sourceRelease,
        plan.targetRelease,
        JSON.stringify(completedActionIndexes),
        String(now),
        String(now),
      ],
    );
    return;
  }
  await input.query(
    `INSERT INTO deployment_attempts
       (id, plan_digest, source_release, target_release, target_manifest_digest,
        source_state_digest, target_schema_version, target_artifact_digests,
        status, completed_actions, stage_outcomes, recovery_action, started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, '[]', NULLIF(?, ''), ?, ?)`,
    [
      attemptId,
      plan.digest,
      plan.sourceRelease,
      plan.targetRelease,
      plan.targetManifestDigest,
      plan.sourceStateDigest,
      String(plan.targetSchemaVersion),
      JSON.stringify(plan.targetArtifactDigests),
      JSON.stringify(completedActionIndexes),
      recoveryAction(plan.actions),
      String(now),
      String(now),
    ],
  );
}

function recoveryAction(actions: readonly DeploymentAction[]): string {
  const action = actions.find((candidate) => candidate.kind === "recover");
  return action?.kind === "recover" ? action.action : "";
}

function parseCompletedActions(serialized: string): readonly number[] {
  const parsed: unknown = JSON.parse(serialized);
  return z.array(z.number().int().nonnegative()).parse(parsed);
}

async function recordFailure(
  input: Readonly<{ query: D1DeploymentQuery; now: () => Date }>,
  attemptId: string,
  failure: DeploymentFailure,
): Promise<void> {
  const completedAt = input.now().getTime();
  const columns = await deploymentAttemptColumns(input);
  if (
    columns.has("stage_outcomes") &&
    columns.has("failure_resource") &&
    columns.has("required_permission")
  ) {
    await input.query(
      `UPDATE deployment_attempts
       SET status = 'failed', failure_kind = ?, failed_stage = ?,
           stage_outcomes = json_insert(stage_outcomes, '$[#]', json(?)),
           recovery_action = ?, failure_resource = ?, required_permission = ?, updated_at = ?
       WHERE id = ?`,
      [
        failure.kind,
        failure.stage,
        JSON.stringify({ stage: failure.stage, failedAt: completedAt, kind: failure.kind }),
        failure.recovery,
        failure.resource ?? null,
        failure.requiredPermission ?? null,
        String(completedAt),
        attemptId,
      ],
    );
    return;
  }
  if (columns.has("stage_outcomes")) {
    await input.query(
      `UPDATE deployment_attempts
       SET status = 'failed', failure_kind = ?, failed_stage = ?,
           stage_outcomes = json_insert(stage_outcomes, '$[#]', json(?)),
           recovery_action = ?, updated_at = ?
       WHERE id = ?`,
      [
        failure.kind,
        failure.stage,
        JSON.stringify({ stage: failure.stage, failedAt: completedAt, kind: failure.kind }),
        failure.recovery,
        String(completedAt),
        attemptId,
      ],
    );
    return;
  }
  await input.query(
    `UPDATE deployment_attempts
     SET status = 'failed', failure_kind = ?, failed_stage = ?, updated_at = ?
     WHERE id = ?`,
    [failure.kind, failure.stage, String(completedAt), attemptId],
  );
}
