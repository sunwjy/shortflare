import type {
  CredentialUser,
  OpenedSession,
  ReauthenticationSession,
  RequestSession,
  SessionPersistence,
} from "../../application/sessions";
import type { User } from "../../application/shared";

export function createD1SessionPersistence(database: D1Database): SessionPersistence {
  return {
    findCredentialByEmail(normalizedEmail) {
      return database
        .prepare(
          `SELECT users.id, users.display_email AS email, users.role, users.state,
                  credentials.verifier
           FROM users
           LEFT JOIN credentials ON credentials.user_id = users.id
           WHERE users.normalized_email = ?`,
        )
        .bind(normalizedEmail)
        .first<CredentialUser>();
    },
    async updateVerifier(userId, verifier, occurredAt) {
      await database
        .prepare("UPDATE credentials SET verifier = ?, updated_at = ? WHERE user_id = ?")
        .bind(verifier, occurredAt, userId)
        .run();
    },
    async create(input) {
      await database
        .prepare(
          `INSERT INTO sessions
             (id, user_id, token_hash, csrf_token, created_at, last_seen_at,
              idle_expires_at, absolute_expires_at, recent_authentication_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.sessionId,
          input.userId,
          input.tokenHash,
          input.csrfToken,
          input.occurredAt,
          input.occurredAt,
          input.idleExpiresAt,
          input.absoluteExpiresAt,
          input.occurredAt,
        )
        .run();
    },
    findActiveUser(tokenHash, occurredAt) {
      return database
        .prepare(
          `SELECT users.id, users.display_email AS email, users.role, users.state
           FROM sessions
           INNER JOIN users ON users.id = sessions.user_id
           WHERE sessions.token_hash = ?
             AND sessions.idle_expires_at > ?
             AND sessions.absolute_expires_at > ?
             AND users.state = 'active'`,
        )
        .bind(tokenHash, occurredAt, occurredAt)
        .first<User>();
    },
    findRequest(tokenHash, occurredAt) {
      return database
        .prepare(
          `SELECT users.id, users.display_email AS email, users.role, users.state,
                  sessions.csrf_token AS csrfToken,
                  sessions.last_seen_at AS lastSeenAt,
                  sessions.absolute_expires_at AS absoluteExpiresAt,
                  sessions.recent_authentication_at AS recentAuthenticationAt
           FROM sessions
           INNER JOIN users ON users.id = sessions.user_id
           WHERE sessions.token_hash = ?
             AND sessions.idle_expires_at > ?
             AND sessions.absolute_expires_at > ?
             AND users.state = 'active'`,
        )
        .bind(tokenHash, occurredAt, occurredAt)
        .first<RequestSession>();
    },
    async refresh(input) {
      await database
        .prepare(
          `UPDATE sessions SET last_seen_at = ?, idle_expires_at = ?
           WHERE token_hash = ? AND last_seen_at = ?`,
        )
        .bind(input.occurredAt, input.idleExpiresAt, input.tokenHash, input.expectedLastSeenAt)
        .run();
    },
    open(tokenHash, occurredAt) {
      return database
        .prepare(
          `SELECT sessions.csrf_token AS csrfToken,
                  sessions.absolute_expires_at AS absoluteExpiresAt,
                  users.id, users.display_email AS email, users.role, users.state
           FROM sessions
           INNER JOIN users ON users.id = sessions.user_id
           WHERE sessions.token_hash = ?
             AND sessions.idle_expires_at > ?
             AND sessions.absolute_expires_at > ?
             AND users.state = 'active'`,
        )
        .bind(tokenHash, occurredAt, occurredAt)
        .first<OpenedSession>();
    },
    findForReauthentication(tokenHash, occurredAt) {
      return database
        .prepare(
          `SELECT sessions.id AS sessionId,
                  sessions.absolute_expires_at AS absoluteExpiresAt,
                  users.id, users.display_email AS email, users.role, users.state,
                  credentials.verifier
           FROM sessions
           INNER JOIN users ON users.id = sessions.user_id
           INNER JOIN credentials ON credentials.user_id = users.id
           WHERE sessions.token_hash = ?
             AND sessions.idle_expires_at > ?
             AND sessions.absolute_expires_at > ?
             AND users.state = 'active'`,
        )
        .bind(tokenHash, occurredAt, occurredAt)
        .first<ReauthenticationSession>();
    },
    async rotate(input) {
      await database
        .prepare(
          `UPDATE sessions
           SET token_hash = ?, csrf_token = ?, last_seen_at = ?,
               idle_expires_at = ?, recent_authentication_at = ?
           WHERE id = ?`,
        )
        .bind(
          input.tokenHash,
          input.csrfToken,
          input.occurredAt,
          input.idleExpiresAt,
          input.occurredAt,
          input.sessionId,
        )
        .run();
    },
    findCredentialByUserId(userId) {
      return database
        .prepare(
          `SELECT users.id, users.display_email AS email, users.role, users.state,
                  credentials.verifier
           FROM users
           INNER JOIN credentials ON credentials.user_id = users.id
           WHERE users.id = ? AND users.state = 'active'`,
        )
        .bind(userId)
        .first<User & { verifier: string }>();
    },
    async changePassword(input) {
      // Password replacement, its Audit Event, and revocation of every Session
      // are one D1 transaction, so all existing Sessions are revoked with it.
      const results = await database.batch([
        database
          .prepare(
            `INSERT INTO audit_events
               (id, actor_id, action, subject_id, occurred_at, metadata)
             SELECT ?, id, 'password-change', id, ?, '{}'
             FROM users WHERE id = ? AND state = 'active'`,
          )
          .bind(input.auditId, input.occurredAt, input.userId),
        database
          .prepare(
            `UPDATE credentials SET verifier = ?, updated_at = ?
             WHERE user_id = ?`,
          )
          .bind(input.verifier, input.occurredAt, input.userId),
        database.prepare("DELETE FROM sessions WHERE user_id = ?").bind(input.userId),
      ]);
      return (results[1]?.meta.changes ?? 0) > 0;
    },
    async delete(tokenHash) {
      await database.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    },
  };
}
