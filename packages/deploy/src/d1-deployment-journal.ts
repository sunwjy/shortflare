import { z } from "zod";

import type { DeploymentAttemptJournal, DeploymentFailure } from "./deployment-runner.js";

export type D1DeploymentQuery = (
  sql: string,
  parameters: readonly string[],
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

export function createD1DeploymentJournal(
  input: Readonly<{
    query: D1DeploymentQuery;
    now: () => Date;
    randomId: () => string;
    leaseDurationMs?: number;
  }>,
): DeploymentAttemptJournal {
  const leaseDurationMs = input.leaseDurationMs ?? 60_000;

  return {
    async begin(plan) {
      const now = input.now().getTime();
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

    async recordActionCompleted(attemptId, actionIndex) {
      await input.query(
        `UPDATE deployment_attempts
         SET completed_actions = json_insert(completed_actions, '$[#]', json(?)), updated_at = ?
         WHERE id = ? AND status = 'running'`,
        [String(actionIndex), String(input.now().getTime()), attemptId],
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
    },

    async fail(attemptId, failure) {
      await recordFailure(input, attemptId, failure);
      await input.query("DELETE FROM deployment_lease WHERE singleton_key = 1 AND attempt_id = ?", [
        attemptId,
      ]);
    },
  };
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
  await input.query(
    `UPDATE deployment_attempts
     SET status = 'failed', failure_kind = ?, failed_stage = ?, updated_at = ?
     WHERE id = ?`,
    [failure.kind, failure.stage, String(input.now().getTime()), attemptId],
  );
}
