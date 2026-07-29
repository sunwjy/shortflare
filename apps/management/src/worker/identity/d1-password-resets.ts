import type { PasswordResetPersistence } from "./password-resets";
import type { User } from "./shared";

export function createD1PasswordResetPersistence(database: D1Database): PasswordResetPersistence {
  return {
    findUser(userId) {
      return database
        .prepare(
          `SELECT id, display_email AS email, role, state
           FROM users WHERE id = ?`,
        )
        .bind(userId)
        .first<User>();
    },

    async issue(input) {
      await database.batch([
        database.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(input.userId),
        database
          .prepare(
            `INSERT INTO password_resets (id, user_id, token_hash, issued_at, expires_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(input.resetId, input.userId, input.tokenHash, input.occurredAt, input.expiresAt),
        database
          .prepare(
            `INSERT INTO audit_events
               (id, actor_id, action, subject_id, occurred_at, metadata)
             VALUES (?, ?, 'password-reset-issue', ?, ?, '{}')`,
          )
          .bind(input.auditId, input.actorId, input.userId, input.occurredAt),
      ]);
    },

    findActiveUserByToken(tokenHash, occurredAt) {
      return database
        .prepare(
          `SELECT users.id, users.display_email AS email, users.role, users.state
           FROM password_resets
           INNER JOIN users ON users.id = password_resets.user_id
           WHERE password_resets.token_hash = ?
             AND password_resets.expires_at > ?
             AND users.state = 'active'`,
        )
        .bind(tokenHash, occurredAt)
        .first<User>();
    },

    async use(input) {
      const tokenCondition = `EXISTS (
        SELECT 1 FROM password_resets
        WHERE user_id = ? AND token_hash = ? AND expires_at > ?
      )`;
      const results = await database.batch([
        database
          .prepare(
            `INSERT INTO audit_events
               (id, actor_id, action, subject_id, occurred_at, metadata)
             SELECT ?, id, 'password-reset-use', id, ?, '{}'
             FROM users
             WHERE id = ? AND state = 'active' AND ${tokenCondition}`,
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
             WHERE user_id = ? AND ${tokenCondition}`,
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
          .prepare(
            `DELETE FROM sessions
             WHERE user_id = ? AND ${tokenCondition}`,
          )
          .bind(input.userId, input.userId, input.tokenHash, input.occurredAt),
        database
          .prepare(
            `DELETE FROM password_resets
             WHERE user_id = ? AND token_hash = ? AND expires_at > ?`,
          )
          .bind(input.userId, input.tokenHash, input.occurredAt),
      ]);
      return (results[3]?.meta.changes ?? 0) > 0;
    },
  };
}
