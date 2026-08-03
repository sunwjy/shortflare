import type { InvitationPersistence } from "../../application/invitations";
import type { User } from "../../application/shared";

export function createD1InvitationPersistence(database: D1Database): InvitationPersistence {
  return {
    findUserByNormalizedEmail(normalizedEmail) {
      return database
        .prepare(
          `SELECT id, display_email AS email, role, state
           FROM users WHERE normalized_email = ?`,
        )
        .bind(normalizedEmail)
        .first<User>();
    },

    async issue(input) {
      // Issuing replaces any prior token for this Invited User in the same batch
      // that establishes the User state and records the Audit Event.
      const statements = [
        input.existing
          ? database
              .prepare(
                `UPDATE users
                 SET display_email = ?, role = ?, updated_at = ?
                 WHERE id = ? AND state = 'invited'`,
              )
              .bind(input.displayEmail, input.role, input.occurredAt, input.userId)
          : database
              .prepare(
                `INSERT INTO users
                   (id, display_email, normalized_email, state, role, activated_at, created_at, updated_at)
                 VALUES (?, ?, ?, 'invited', ?, NULL, ?, ?)`,
              )
              .bind(
                input.userId,
                input.displayEmail,
                input.normalizedEmail,
                input.role,
                input.occurredAt,
                input.occurredAt,
              ),
        database.prepare("DELETE FROM invitations WHERE user_id = ?").bind(input.userId),
        database
          .prepare(
            `INSERT INTO invitations (id, user_id, token_hash, issued_at, expires_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(
            input.invitationId,
            input.userId,
            input.tokenHash,
            input.occurredAt,
            input.expiresAt,
          ),
        database
          .prepare(
            `INSERT INTO audit_events
               (id, actor_id, action, subject_id, occurred_at, metadata)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            input.auditId,
            input.actorId,
            input.existing ? "invitation-reissue" : "invitation-issue",
            input.userId,
            input.occurredAt,
            JSON.stringify({
              ...(input.existing ? { fromRole: input.existing.role } : {}),
              toRole: input.role,
              toUserState: "invited",
            }),
          ),
      ];
      try {
        await database.batch(statements);
        return true;
      } catch {
        return false;
      }
    },

    findInvitedUser(tokenHash, occurredAt) {
      return database
        .prepare(
          `SELECT users.id, users.display_email AS email, users.role, users.state
           FROM invitations
           INNER JOIN users ON users.id = invitations.user_id
           WHERE invitations.token_hash = ?
             AND invitations.expires_at > ?
             AND users.state = 'invited'`,
        )
        .bind(tokenHash, occurredAt)
        .first<User>();
    },

    async accept(input) {
      // Token consumption, credential creation, activation, and its Audit Event
      // are one transition so an Invitation cannot be partially accepted.
      try {
        const results = await database.batch([
          database
            .prepare("DELETE FROM invitations WHERE user_id = ? AND token_hash = ?")
            .bind(input.userId, input.tokenHash),
          database
            .prepare(
              `INSERT INTO credentials (user_id, verifier, updated_at)
               VALUES (?, ?, ?)`,
            )
            .bind(input.userId, input.verifier, input.occurredAt),
          database
            .prepare(
              `UPDATE users
               SET state = 'active', activated_at = ?, updated_at = ?
               WHERE id = ? AND state = 'invited'`,
            )
            .bind(input.occurredAt, input.occurredAt, input.userId),
          database
            .prepare(
              `INSERT INTO audit_events
                 (id, actor_id, action, subject_id, occurred_at, metadata)
               VALUES (?, ?, 'invitation-accept', ?, ?, ?)`,
            )
            .bind(
              input.auditId,
              input.userId,
              input.userId,
              input.occurredAt,
              JSON.stringify({ fromUserState: "invited", toUserState: "active" }),
            ),
        ]);
        return (results[2]?.meta.changes ?? 0) > 0;
      } catch {
        return false;
      }
    },

    async cancel(input) {
      const results = await database.batch([
        database
          .prepare(
            `INSERT INTO audit_events
               (id, actor_id, action, subject_id, occurred_at, metadata)
             SELECT ?, ?, 'invitation-cancel', id, ?, ?
             FROM users
             WHERE id = ? AND state = 'invited'`,
          )
          .bind(
            input.auditId,
            input.actorId,
            input.occurredAt,
            JSON.stringify({ fromUserState: "invited" }),
            input.userId,
          ),
        database.prepare("DELETE FROM users WHERE id = ? AND state = 'invited'").bind(input.userId),
      ]);
      return (results[1]?.meta.changes ?? 0) > 0;
    },
  };
}
