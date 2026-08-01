import type { OperatorRecoveryPersistence } from "./operator-recovery";
import type { User } from "./shared";

export function createD1OperatorRecoveryPersistence(
  database: D1Database,
): OperatorRecoveryPersistence {
  return {
    findActiveAdministrator(normalizedEmail) {
      return database
        .prepare(
          `SELECT id, display_email AS email, role, state
           FROM users
           WHERE normalized_email = ? AND state = 'active' AND role = 'administrator'`,
        )
        .bind(normalizedEmail)
        .first<User>();
    },
    async write(input) {
      await database.batch([
        database.prepare("DELETE FROM operator_recovery WHERE singleton_key = 1"),
        database
          .prepare(
            `INSERT INTO operator_recovery
               (singleton_key, user_id, token_hash, created_at, expires_at)
             VALUES (1, ?, ?, ?, ?)`,
          )
          .bind(input.userId, input.tokenHash, input.createdAt, input.expiresAt),
      ]);
    },
    findActiveAdministratorByToken(tokenHash, occurredAt) {
      return database
        .prepare(
          `SELECT users.id, users.display_email AS email, users.role, users.state
           FROM operator_recovery
           INNER JOIN users ON users.id = operator_recovery.user_id
           WHERE operator_recovery.singleton_key = 1
             AND operator_recovery.token_hash = ?
             AND operator_recovery.expires_at > ?
             AND users.state = 'active'
             AND users.role = 'administrator'`,
        )
        .bind(tokenHash, occurredAt)
        .first<User>();
    },
    async use(input) {
      // ADR-0008 makes recovery a one-time atomic handoff. Repeating the token
      // condition prevents any side effect if the handoff expires or is consumed.
      const condition = `EXISTS (
        SELECT 1 FROM operator_recovery
        WHERE singleton_key = 1 AND user_id = ? AND token_hash = ? AND expires_at > ?
      )`;
      const results = await database.batch([
        database
          .prepare(
            `INSERT INTO audit_events
               (id, actor_id, action, subject_id, occurred_at, metadata)
             SELECT ?, 'system', 'operator-recovery', id, ?, '{}'
             FROM users
             WHERE id = ? AND state = 'active' AND role = 'administrator' AND ${condition}`,
          )
          .bind(
            input.auditId,
            input.occurredAt,
            input.userId,
            input.userId,
            input.tokenHash,
            input.occurredAt,
          ),
        database
          .prepare(
            `UPDATE credentials SET verifier = ?, updated_at = ?
             WHERE user_id = ? AND ${condition}`,
          )
          .bind(
            input.verifier,
            input.occurredAt,
            input.userId,
            input.userId,
            input.tokenHash,
            input.occurredAt,
          ),
        database
          .prepare(`DELETE FROM sessions WHERE user_id = ? AND ${condition}`)
          .bind(input.userId, input.userId, input.tokenHash, input.occurredAt),
        database
          .prepare(
            `DELETE FROM operator_recovery
             WHERE singleton_key = 1 AND user_id = ?
               AND token_hash = ? AND expires_at > ?`,
          )
          .bind(input.userId, input.tokenHash, input.occurredAt),
      ]);
      return (results[3]?.meta.changes ?? 0) > 0;
    },
  };
}
