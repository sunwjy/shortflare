import type { InitialSetupPersistence } from "./initial-setup";

export function createD1InitialSetupPersistence(database: D1Database): InitialSetupPersistence {
  return {
    async isAvailable() {
      const result = await database
        .prepare(
          `SELECT
             instances.setup_completed_at AS setupCompletedAt,
             EXISTS (
               SELECT 1 FROM users
               WHERE state = 'active' AND role = 'administrator'
             ) AS hasActiveAdministrator
           FROM instances WHERE singleton_key = 1`,
        )
        .first<{ setupCompletedAt: number | null; hasActiveAdministrator: number }>();
      return Boolean(
        result && result.setupCompletedAt === null && result.hasActiveAdministrator !== 1,
      );
    },
    async write(input) {
      await database.batch([
        database.prepare(
          `DELETE FROM initial_setup
           WHERE singleton_key = 1
             AND EXISTS (
               SELECT 1 FROM instances
               WHERE singleton_key = 1 AND setup_completed_at IS NULL
             )
             AND NOT EXISTS (
               SELECT 1 FROM users
               WHERE state = 'active' AND role = 'administrator'
             )`,
        ),
        database
          .prepare(
            `INSERT INTO initial_setup
               (singleton_key, display_email, normalized_email, token_hash, created_at, expires_at)
             SELECT 1, ?, ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM instances
               WHERE singleton_key = 1 AND setup_completed_at IS NULL
             )
             AND NOT EXISTS (
               SELECT 1 FROM users
               WHERE state = 'active' AND role = 'administrator'
             )`,
          )
          .bind(
            input.displayEmail,
            input.normalizedEmail,
            input.tokenHash,
            input.createdAt,
            input.expiresAt,
          ),
      ]);
    },
    find(tokenHash, occurredAt) {
      return database
        .prepare(
          `SELECT display_email AS displayEmail, normalized_email AS normalizedEmail
           FROM initial_setup
           WHERE singleton_key = 1 AND token_hash = ? AND expires_at > ?`,
        )
        .bind(tokenHash, occurredAt)
        .first<{ displayEmail: string; normalizedEmail: string }>();
    },
    async complete(input) {
      // ADR-0007 requires one atomic handoff consumption: the first Administrator,
      // credential, completion marker, and Audit Event either all commit or none do.
      try {
        await database.batch([
          database
            .prepare(
              `DELETE FROM initial_setup
               WHERE singleton_key = 1 AND token_hash = ? AND expires_at > ?`,
            )
            .bind(input.tokenHash, input.occurredAt),
          database
            .prepare(
              `INSERT INTO users
                 (id, display_email, normalized_email, state, role, activated_at, created_at, updated_at)
               VALUES (?, ?, ?, 'active', 'administrator', ?, ?, ?)`,
            )
            .bind(
              input.userId,
              input.displayEmail,
              input.normalizedEmail,
              input.occurredAt,
              input.occurredAt,
              input.occurredAt,
            ),
          database
            .prepare("INSERT INTO credentials (user_id, verifier, updated_at) VALUES (?, ?, ?)")
            .bind(input.userId, input.verifier, input.occurredAt),
          database
            .prepare(
              `UPDATE instances SET setup_completed_at = ?
               WHERE singleton_key = 1 AND setup_completed_at IS NULL`,
            )
            .bind(input.occurredAt),
          database
            .prepare(
              `INSERT INTO audit_events
                 (id, actor_id, action, subject_id, occurred_at, metadata)
               VALUES (?, 'system', 'initial-administrator-activate', ?, ?, ?)`,
            )
            .bind(
              input.auditId,
              input.userId,
              input.occurredAt,
              JSON.stringify({ toRole: "administrator", toUserState: "active" }),
            ),
        ]);
        return true;
      } catch {
        return false;
      }
    },
  };
}
