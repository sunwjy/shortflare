import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

import { createPasswordVerifier, dummyVerifier, verifyPassword } from "./passwords";
import { createRandomToken, hashToken, parseUserEmail, toUser, type User } from "./identity/shared";
import { createD1InvitationPersistence } from "./identity/d1-invitations";
import { createInvitations } from "./identity/invitations";
import { createD1UserPersistence } from "./identity/d1-users";
import { createUsers } from "./identity/users";
import { createD1PasswordResetPersistence } from "./identity/d1-password-resets";
import { createPasswordResets } from "./identity/password-resets";
import { createD1OperatorRecoveryPersistence } from "./identity/d1-operator-recovery";
import { createOperatorRecovery } from "./identity/operator-recovery";
import { createD1InitialSetupPersistence } from "./identity/d1-initial-setup";
import { createInitialSetup } from "./identity/initial-setup";

export type { User, UserRole, UserState } from "./identity/shared";

type PasswordFailure = Readonly<{ ok: false; kind: "invalid-password" }>;
type IdentityOptions = Readonly<{
  db: D1Database;
  now?: () => Date;
  randomId?: () => string;
  randomToken?: () => string;
}>;

type UserResult = Readonly<{ ok: true; kind: "user"; user: User }>;
type RequestUserResult = Readonly<{
  ok: true;
  kind: "user";
  user: User;
  recentlyAuthenticated: boolean;
}>;
type LoginFailure = Readonly<{ ok: false; kind: "invalid-credentials" }>;
type CsrfFailure = Readonly<{ ok: false; kind: "invalid-csrf-token" }>;
type ReauthenticationFailure = Readonly<{
  ok: false;
  kind: "reauthentication-required";
}>;
type SessionResult = Readonly<{
  ok: true;
  kind: "session";
  session: Readonly<{
    token: string;
    csrfToken: string;
    expiresAt: Date;
    user: User;
  }>;
}>;
const idleSessionDuration = 7 * 24 * 60 * 60 * 1_000;
const absoluteSessionDuration = 30 * 24 * 60 * 60 * 1_000;
const recentAuthenticationDuration = 10 * 60 * 1_000;

/**
 * Owns User lifecycle, credentials, one-time tokens, and Session policy for one
 * Instance. Successful administrative User and credential changes persist their
 * Audit Event in the same D1 batch; rejected and no-op operations must not leave
 * an Audit Event. Session creation and refresh are intentionally not Audit
 * Events.
 *
 * Token-returning methods expose the plaintext secret exactly once while only
 * its hash is persisted. Callers are responsible for transport authorization
 * and for delivering that secret without logging it.
 */
export function createIdentity(options: IdentityOptions) {
  const now = options.now ?? (() => new Date());
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const randomToken = options.randomToken ?? createRandomToken;
  const invitations = createInvitations({
    persistence: createD1InvitationPersistence(options.db),
    now,
    randomId,
    randomToken,
  });
  const users = createUsers(createD1UserPersistence(options.db), { now, randomId });
  const passwordResets = createPasswordResets(createD1PasswordResetPersistence(options.db), {
    now,
    randomId,
    randomToken,
  });
  const operatorRecovery = createOperatorRecovery(createD1OperatorRecoveryPersistence(options.db), {
    now,
    randomId,
  });
  const initialSetup = createInitialSetup(createD1InitialSetupPersistence(options.db), {
    now,
    randomId,
  });

  return {
    writeInitialSetup: initialSetup.writeInitialSetup,

    completeInitialSetup: initialSetup.completeInitialSetup,

    async login(
      input: Readonly<{ email: string; password: string }>,
    ): Promise<LoginFailure | SessionResult> {
      const email = parseUserEmail(input.email);
      const record = email
        ? await options.db
            .prepare(
              `SELECT
                 users.id,
                 users.display_email AS email,
                 users.role,
                 users.state,
                 credentials.verifier
               FROM users
               LEFT JOIN credentials ON credentials.user_id = users.id
               WHERE users.normalized_email = ?`,
            )
            .bind(email.normalized)
            .first<User & { verifier: string | null }>()
        : null;
      const verification = await verifyPassword(input.password, record?.verifier ?? dummyVerifier);
      if (!record || record.state !== "active" || !record.verifier || !verification.valid) {
        return { ok: false, kind: "invalid-credentials" };
      }

      const occurredAt = now().getTime();
      if (verification.needsRehash) {
        const verifier = await createPasswordVerifier(input.password);
        if (!verifier) {
          return { ok: false, kind: "invalid-credentials" };
        }
        await options.db
          .prepare("UPDATE credentials SET verifier = ?, updated_at = ? WHERE user_id = ?")
          .bind(verifier, occurredAt, record.id)
          .run();
      }
      const sessionId = randomId();
      const token = randomToken();
      const csrfToken = randomToken();
      const expiresAt = new Date(occurredAt + absoluteSessionDuration);
      await options.db
        .prepare(
          `INSERT INTO sessions
             (id, user_id, token_hash, csrf_token, created_at, last_seen_at,
              idle_expires_at, absolute_expires_at, recent_authentication_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          sessionId,
          record.id,
          await hashToken(token),
          csrfToken,
          occurredAt,
          occurredAt,
          occurredAt + idleSessionDuration,
          expiresAt.getTime(),
          occurredAt,
        )
        .run();

      return {
        ok: true,
        kind: "session",
        session: {
          token,
          csrfToken,
          expiresAt,
          user: toUser(record),
        },
      };
    },

    async authenticate(token: string): Promise<LoginFailure | UserResult> {
      const occurredAt = now().getTime();
      const record = await options.db
        .prepare(
          `SELECT users.id, users.display_email AS email, users.role, users.state
           FROM sessions
           INNER JOIN users ON users.id = sessions.user_id
           WHERE sessions.token_hash = ?
             AND sessions.idle_expires_at > ?
             AND sessions.absolute_expires_at > ?
             AND users.state = 'active'`,
        )
        .bind(await hashToken(token), occurredAt, occurredAt)
        .first<User>();
      if (!record) {
        return { ok: false, kind: "invalid-credentials" };
      }
      return { ok: true, kind: "user", user: toUser(record) };
    },

    async authenticateRequest(
      token: string,
      csrfToken: string,
      requireRecentAuthentication = false,
    ): Promise<LoginFailure | CsrfFailure | ReauthenticationFailure | RequestUserResult> {
      const occurredAt = now().getTime();
      const record = await options.db
        .prepare(
          `SELECT
             users.id,
             users.display_email AS email,
             users.role,
             users.state,
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
        .bind(await hashToken(token), occurredAt, occurredAt)
        .first<
          User & {
            csrfToken: string;
            lastSeenAt: number;
            absoluteExpiresAt: number;
            recentAuthenticationAt: number;
          }
        >();
      if (!record) {
        return { ok: false, kind: "invalid-credentials" };
      }
      if (
        Buffer.byteLength(record.csrfToken) !== Buffer.byteLength(csrfToken) ||
        !timingSafeEqual(Buffer.from(record.csrfToken), Buffer.from(csrfToken))
      ) {
        return { ok: false, kind: "invalid-csrf-token" };
      }
      const recentlyAuthenticated =
        occurredAt - record.recentAuthenticationAt <= recentAuthenticationDuration;
      if (requireRecentAuthentication && !recentlyAuthenticated) {
        return { ok: false, kind: "reauthentication-required" };
      }
      if (occurredAt - record.lastSeenAt >= 60 * 60 * 1_000) {
        await options.db
          .prepare(
            `UPDATE sessions
             SET last_seen_at = ?, idle_expires_at = ?
             WHERE token_hash = ? AND last_seen_at = ?`,
          )
          .bind(
            occurredAt,
            Math.min(occurredAt + idleSessionDuration, record.absoluteExpiresAt),
            await hashToken(token),
            record.lastSeenAt,
          )
          .run();
      }
      return {
        ok: true,
        kind: "user",
        user: toUser(record),
        recentlyAuthenticated,
      };
    },

    async openSession(token: string): Promise<LoginFailure | SessionResult> {
      const occurredAt = now().getTime();
      const record = await options.db
        .prepare(
          `SELECT
             sessions.csrf_token AS csrfToken,
             sessions.absolute_expires_at AS absoluteExpiresAt,
             users.id,
             users.display_email AS email,
             users.role,
             users.state
           FROM sessions
           INNER JOIN users ON users.id = sessions.user_id
           WHERE sessions.token_hash = ?
             AND sessions.idle_expires_at > ?
             AND sessions.absolute_expires_at > ?
             AND users.state = 'active'`,
        )
        .bind(await hashToken(token), occurredAt, occurredAt)
        .first<User & { csrfToken: string; absoluteExpiresAt: number }>();
      if (!record) {
        return { ok: false, kind: "invalid-credentials" };
      }
      return {
        ok: true,
        kind: "session",
        session: {
          token,
          csrfToken: record.csrfToken,
          expiresAt: new Date(record.absoluteExpiresAt),
          user: toUser(record),
        },
      };
    },

    issueInvitation: invitations.issueInvitation,

    listUsers: users.listUsers,

    getUser: users.getUser,

    acceptInvitation: invitations.acceptInvitation,

    cancelInvitation: invitations.cancelInvitation,

    changeRole: users.changeRole,

    suspendUser: users.suspendUser,

    reactivateUser: users.reactivateUser,

    issuePasswordReset: passwordResets.issuePasswordReset,

    usePasswordReset: passwordResets.usePasswordReset,

    async reauthenticate(
      input: Readonly<{ token: string; password: string }>,
    ): Promise<LoginFailure | SessionResult> {
      const occurredAt = now().getTime();
      const record = await options.db
        .prepare(
          `SELECT
             sessions.id AS sessionId,
             sessions.absolute_expires_at AS absoluteExpiresAt,
             users.id,
             users.display_email AS email,
             users.role,
             users.state,
             credentials.verifier
           FROM sessions
           INNER JOIN users ON users.id = sessions.user_id
           INNER JOIN credentials ON credentials.user_id = users.id
           WHERE sessions.token_hash = ?
             AND sessions.idle_expires_at > ?
             AND sessions.absolute_expires_at > ?
             AND users.state = 'active'`,
        )
        .bind(await hashToken(input.token), occurredAt, occurredAt)
        .first<User & { sessionId: string; absoluteExpiresAt: number; verifier: string }>();
      const verification = record
        ? await verifyPassword(input.password, record.verifier)
        : undefined;
      if (!record || !verification?.valid) {
        return { ok: false, kind: "invalid-credentials" };
      }

      const token = randomToken();
      const csrfToken = randomToken();
      await options.db
        .prepare(
          `UPDATE sessions
           SET token_hash = ?, csrf_token = ?, last_seen_at = ?,
               idle_expires_at = ?, recent_authentication_at = ?
           WHERE id = ?`,
        )
        .bind(
          await hashToken(token),
          csrfToken,
          occurredAt,
          Math.min(occurredAt + idleSessionDuration, record.absoluteExpiresAt),
          occurredAt,
          record.sessionId,
        )
        .run();
      return {
        ok: true,
        kind: "session",
        session: {
          token,
          csrfToken,
          expiresAt: new Date(record.absoluteExpiresAt),
          user: toUser(record),
        },
      };
    },

    async changePassword(
      input: Readonly<{ userId: string; currentPassword: string; password: string }>,
    ): Promise<PasswordFailure | LoginFailure | Readonly<{ ok: true; kind: "password-changed" }>> {
      const record = await options.db
        .prepare(
          `SELECT
             users.id,
             users.display_email AS email,
             users.role,
             users.state,
             credentials.verifier
           FROM users
           INNER JOIN credentials ON credentials.user_id = users.id
           WHERE users.id = ? AND users.state = 'active'`,
        )
        .bind(input.userId)
        .first<User & { verifier: string }>();
      const verification = record
        ? await verifyPassword(input.currentPassword, record.verifier)
        : undefined;
      if (!record || !verification?.valid) {
        return { ok: false, kind: "invalid-credentials" };
      }
      const verifier = await createPasswordVerifier(input.password);
      if (!verifier) {
        return { ok: false, kind: "invalid-password" };
      }

      const occurredAt = now().getTime();
      const results = await options.db.batch([
        options.db
          .prepare(
            `INSERT INTO audit_events
               (id, actor_id, action, subject_id, occurred_at, metadata)
             SELECT ?, id, 'password-change', id, ?, '{}'
             FROM users WHERE id = ? AND state = 'active'`,
          )
          .bind(randomId(), occurredAt, record.id),
        options.db
          .prepare(
            `UPDATE credentials SET verifier = ?, updated_at = ?
             WHERE user_id = ?`,
          )
          .bind(verifier, occurredAt, record.id),
        options.db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(record.id),
      ]);
      return (results[1]?.meta.changes ?? 0) > 0
        ? { ok: true, kind: "password-changed" }
        : { ok: false, kind: "invalid-credentials" };
    },

    async logout(token: string): Promise<Readonly<{ ok: true; kind: "logged-out" }>> {
      await options.db
        .prepare("DELETE FROM sessions WHERE token_hash = ?")
        .bind(await hashToken(token))
        .run();
      return { ok: true, kind: "logged-out" };
    },

    writeOperatorRecovery: operatorRecovery.writeOperatorRecovery,

    useOperatorRecovery: operatorRecovery.useOperatorRecovery,
  };
}
