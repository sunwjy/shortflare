import type { UserPersistence } from "./users";
import type { User } from "./shared";

/**
 * Persists User lifecycle changes with their Audit Event and Session revocation.
 * Write-time guards enforce recent authentication and preserve at least one
 * Active Administrator without trusting an earlier application read.
 */
export function createD1UserPersistence(database: D1Database): UserPersistence {
  return {
    async list() {
      const result = await database
        .prepare(
          `SELECT id, display_email AS email, role, state
           FROM users
           ORDER BY created_at, id`,
        )
        .all<User>();
      return result.results;
    },

    find(userId) {
      return database
        .prepare(
          `SELECT id, display_email AS email, role, state
           FROM users WHERE id = ?`,
        )
        .bind(userId)
        .first<User>();
    },

    async changeRole(input) {
      const guard = roleChangeGuard;
      const metadata = JSON.stringify({ fromRole: input.storedRole, toRole: input.role });
      // Audit insertion and mutation deliberately share the same guard. The D1
      // batch then makes the audit, state change, and Session revocation atomic.
      const results = await database.batch([
        database
          .prepare(
            `INSERT INTO audit_events
               (id, actor_id, action, subject_id, occurred_at, metadata)
             SELECT ?, ?, 'role-change', id, ?, ?
             FROM users WHERE ${guard}`,
          )
          .bind(
            input.auditId,
            input.actorId,
            input.occurredAt,
            metadata,
            input.userId,
            input.storedRole,
            input.recentlyAuthenticated ? 1 : 0,
            input.role,
            input.role,
          ),
        database
          .prepare(`UPDATE users SET role = ?, updated_at = ? WHERE ${guard}`)
          .bind(
            input.role,
            input.occurredAt,
            input.userId,
            input.storedRole,
            input.recentlyAuthenticated ? 1 : 0,
            input.role,
            input.role,
          ),
        database
          .prepare(
            `DELETE FROM sessions
             WHERE user_id = ?
               AND EXISTS (SELECT 1 FROM users WHERE id = ? AND role = ?)`,
          )
          .bind(input.userId, input.userId, input.role),
      ]);
      return changed(results);
    },

    async suspend(input) {
      const metadata = JSON.stringify({
        fromUserState: "active",
        toUserState: "suspended",
      });
      // Keep the protection predicate identical for the Audit Event and update;
      // otherwise a concurrent role change could make their outcomes disagree.
      const results = await database.batch([
        database
          .prepare(
            `INSERT INTO audit_events
               (id, actor_id, action, subject_id, occurred_at, metadata)
             SELECT ?, ?, 'user-suspend', id, ?, ?
             FROM users WHERE ${suspendGuard}`,
          )
          .bind(
            input.auditId,
            input.actorId,
            input.occurredAt,
            metadata,
            input.userId,
            input.recentlyAuthenticated ? 1 : 0,
          ),
        database
          .prepare(`UPDATE users SET state = 'suspended', updated_at = ? WHERE ${suspendGuard}`)
          .bind(input.occurredAt, input.userId, input.recentlyAuthenticated ? 1 : 0),
        database
          .prepare(
            `DELETE FROM sessions
             WHERE user_id = ?
               AND EXISTS (SELECT 1 FROM users WHERE id = ? AND state = 'suspended')`,
          )
          .bind(input.userId, input.userId),
      ]);
      return changed(results);
    },

    async reactivate(input) {
      const metadata = JSON.stringify({
        fromUserState: "suspended",
        toUserState: "active",
      });
      const results = await database.batch([
        database
          .prepare(
            `INSERT INTO audit_events
               (id, actor_id, action, subject_id, occurred_at, metadata)
             SELECT ?, ?, 'user-reactivate', id, ?, ?
             FROM users WHERE id = ? AND state = 'suspended'`,
          )
          .bind(input.auditId, input.actorId, input.occurredAt, metadata, input.userId),
        database
          .prepare(
            `UPDATE users SET state = 'active', updated_at = ?
             WHERE id = ? AND state = 'suspended'`,
          )
          .bind(input.occurredAt, input.userId),
      ]);
      return changed(results);
    },
  };
}

const roleChangeGuard = `id = ? AND role = ? AND state IN ('active', 'suspended')
  AND (
    ? = 1
    OR (? != 'administrator' AND role != 'administrator')
  )
  AND NOT (
    state = 'active'
    AND role = 'administrator'
    AND ? != 'administrator'
    AND (
      SELECT COUNT(*) FROM users
      WHERE state = 'active' AND role = 'administrator'
    ) = 1
  )`;

const suspendGuard = `id = ? AND state = 'active'
  AND (? = 1 OR role != 'administrator')
  AND NOT (
    role = 'administrator'
    AND (
      SELECT COUNT(*) FROM users
      WHERE state = 'active' AND role = 'administrator'
    ) = 1
  )`;

function changed(results: D1Result[]) {
  return (results[1]?.meta.changes ?? 0) > 0;
}
