import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

import { createPasswordVerifier, dummyVerifier, verifyPassword } from "./passwords";
import {
  createRandomToken,
  findUser,
  hashToken,
  parseUserEmail,
  toUser,
  type User,
  type UserRole,
} from "./identity/shared";
import { createD1InvitationPersistence } from "./identity/d1-invitations";
import { createInvitations } from "./identity/invitations";

export type { User, UserRole, UserState } from "./identity/shared";

type IdentityOptions = Readonly<{
  db: D1Database;
  now?: () => Date;
  randomId?: () => string;
  randomToken?: () => string;
}>;

type InitialSetupInput = Readonly<{
  displayEmail: string;
  token: string;
  expiresAt: Date;
}>;

type CompleteInitialSetupInput = Readonly<{
  token: string;
  password: string;
}>;

type TokenFailure = Readonly<{ ok: false; kind: "invalid-or-expired-token" }>;
type PasswordFailure = Readonly<{ ok: false; kind: "invalid-password" }>;
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
type PasswordResetResult = Readonly<{
  ok: true;
  kind: "password-reset";
  passwordReset: Readonly<{
    user: User;
    token: string;
    expiresAt: Date;
  }>;
}>;

const idleSessionDuration = 7 * 24 * 60 * 60 * 1_000;
const absoluteSessionDuration = 30 * 24 * 60 * 60 * 1_000;
const passwordResetDuration = 30 * 60 * 1_000;
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

  return {
    async writeInitialSetup(input: InitialSetupInput): Promise<void> {
      const email = parseUserEmail(input.displayEmail);
      if (!email) {
        throw new Error("Invalid initial Administrator email");
      }
      const setupAvailability = await options.db
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
      if (
        !setupAvailability ||
        setupAvailability.setupCompletedAt !== null ||
        setupAvailability.hasActiveAdministrator === 1
      ) {
        throw new Error("Initial setup is permanently closed");
      }
      const occurredAt = now().getTime();
      const tokenHash = await hashToken(input.token);

      await options.db.batch([
        options.db.prepare(
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
        options.db
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
          .bind(email.display, email.normalized, tokenHash, occurredAt, input.expiresAt.getTime()),
      ]);
    },

    async completeInitialSetup(
      input: CompleteInitialSetupInput,
    ): Promise<TokenFailure | PasswordFailure | UserResult> {
      const occurredAt = now().getTime();
      const tokenHash = await hashToken(input.token);
      const setup = await options.db
        .prepare(
          `SELECT display_email AS displayEmail, normalized_email AS normalizedEmail
           FROM initial_setup
           WHERE singleton_key = 1 AND token_hash = ? AND expires_at > ?`,
        )
        .bind(tokenHash, occurredAt)
        .first<{ displayEmail: string; normalizedEmail: string }>();
      if (!setup) {
        return { ok: false, kind: "invalid-or-expired-token" };
      }

      const verifier = await createPasswordVerifier(input.password);
      if (!verifier) {
        return { ok: false, kind: "invalid-password" };
      }

      const userId = randomId();
      const auditId = randomId();
      try {
        await options.db.batch([
          options.db
            .prepare(
              `DELETE FROM initial_setup
               WHERE singleton_key = 1 AND token_hash = ? AND expires_at > ?`,
            )
            .bind(tokenHash, occurredAt),
          options.db
            .prepare(
              `INSERT INTO users
                 (id, display_email, normalized_email, state, role, activated_at, created_at, updated_at)
               VALUES (?, ?, ?, 'active', 'administrator', ?, ?, ?)`,
            )
            .bind(
              userId,
              setup.displayEmail,
              setup.normalizedEmail,
              occurredAt,
              occurredAt,
              occurredAt,
            ),
          options.db
            .prepare(
              `INSERT INTO credentials (user_id, verifier, updated_at)
               VALUES (?, ?, ?)`,
            )
            .bind(userId, verifier, occurredAt),
          options.db
            .prepare(
              `UPDATE instances SET setup_completed_at = ?
               WHERE singleton_key = 1 AND setup_completed_at IS NULL`,
            )
            .bind(occurredAt),
          options.db
            .prepare(
              `INSERT INTO audit_events
                 (id, actor_id, action, subject_id, occurred_at, metadata)
               VALUES (?, 'system', 'initial-administrator-activate', ?, ?, ?)`,
            )
            .bind(
              auditId,
              userId,
              occurredAt,
              JSON.stringify({ toRole: "administrator", toUserState: "active" }),
            ),
        ]);
      } catch {
        return { ok: false, kind: "invalid-or-expired-token" };
      }

      return {
        ok: true,
        kind: "user",
        user: {
          id: userId,
          email: setup.displayEmail,
          role: "administrator",
          state: "active",
        },
      };
    },

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

    async listUsers(): Promise<readonly User[]> {
      const result = await options.db
        .prepare(
          `SELECT id, display_email AS email, role, state
           FROM users
           ORDER BY created_at, id`,
        )
        .all<User>();
      return result.results.map(toUser);
    },

    async getUser(userId: string): Promise<User | undefined> {
      const user = await findUser(options.db, userId);
      return user ? toUser(user) : undefined;
    },

    acceptInvitation: invitations.acceptInvitation,

    cancelInvitation: invitations.cancelInvitation,

    async changeRole(
      input: Readonly<{
        actorId: string;
        userId: string;
        role: UserRole;
        recentlyAuthenticated: boolean;
      }>,
    ): Promise<
      | Readonly<{ ok: true; kind: "role-changed" | "unchanged" }>
      | Readonly<{
          ok: false;
          kind: "user-not-found" | "last-active-administrator" | "reauthentication-required";
        }>
    > {
      const stored = await findUser(options.db, input.userId);
      if (!stored || stored.state === "invited") {
        return { ok: false, kind: "user-not-found" };
      }
      if (stored.role === input.role) {
        return { ok: true, kind: "unchanged" };
      }

      const occurredAt = now().getTime();
      const guard = `id = ? AND role = ? AND state IN ('active', 'suspended')
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
      const metadata = JSON.stringify({ fromRole: stored.role, toRole: input.role });
      const results = await options.db.batch([
        options.db
          .prepare(
            `INSERT INTO audit_events
               (id, actor_id, action, subject_id, occurred_at, metadata)
             SELECT ?, ?, 'role-change', id, ?, ?
             FROM users WHERE ${guard}`,
          )
          .bind(
            randomId(),
            input.actorId,
            occurredAt,
            metadata,
            input.userId,
            stored.role,
            input.recentlyAuthenticated ? 1 : 0,
            input.role,
            input.role,
          ),
        options.db
          .prepare(`UPDATE users SET role = ?, updated_at = ? WHERE ${guard}`)
          .bind(
            input.role,
            occurredAt,
            input.userId,
            stored.role,
            input.recentlyAuthenticated ? 1 : 0,
            input.role,
            input.role,
          ),
        options.db
          .prepare(
            `DELETE FROM sessions
             WHERE user_id = ?
               AND EXISTS (SELECT 1 FROM users WHERE id = ? AND role = ?)`,
          )
          .bind(input.userId, input.userId, input.role),
      ]);
      if ((results[1]?.meta.changes ?? 0) > 0) {
        return { ok: true, kind: "role-changed" };
      }
      const current = await findUser(options.db, input.userId);
      if (
        !input.recentlyAuthenticated &&
        (input.role === "administrator" || current?.role === "administrator")
      ) {
        return { ok: false, kind: "reauthentication-required" };
      }
      return {
        ok: false,
        kind:
          stored.state === "active" && stored.role === "administrator"
            ? "last-active-administrator"
            : "user-not-found",
      };
    },

    async suspendUser(
      input: Readonly<{
        actorId: string;
        userId: string;
        recentlyAuthenticated: boolean;
      }>,
    ): Promise<
      | Readonly<{ ok: true; kind: "user-suspended" }>
      | Readonly<{
          ok: false;
          kind: "user-not-found" | "last-active-administrator" | "reauthentication-required";
        }>
    > {
      const stored = await findUser(options.db, input.userId);
      if (!stored || stored.state !== "active") {
        return { ok: false, kind: "user-not-found" };
      }
      const occurredAt = now().getTime();
      const guard = `id = ? AND state = 'active'
        AND (? = 1 OR role != 'administrator')
        AND NOT (
          role = 'administrator'
          AND (
            SELECT COUNT(*) FROM users
            WHERE state = 'active' AND role = 'administrator'
          ) = 1
        )`;
      const metadata = JSON.stringify({
        fromUserState: "active",
        toUserState: "suspended",
      });
      const results = await options.db.batch([
        options.db
          .prepare(
            `INSERT INTO audit_events
               (id, actor_id, action, subject_id, occurred_at, metadata)
             SELECT ?, ?, 'user-suspend', id, ?, ?
             FROM users WHERE ${guard}`,
          )
          .bind(
            randomId(),
            input.actorId,
            occurredAt,
            metadata,
            input.userId,
            input.recentlyAuthenticated ? 1 : 0,
          ),
        options.db
          .prepare(`UPDATE users SET state = 'suspended', updated_at = ? WHERE ${guard}`)
          .bind(occurredAt, input.userId, input.recentlyAuthenticated ? 1 : 0),
        options.db
          .prepare(
            `DELETE FROM sessions
             WHERE user_id = ?
               AND EXISTS (SELECT 1 FROM users WHERE id = ? AND state = 'suspended')`,
          )
          .bind(input.userId, input.userId),
      ]);
      if ((results[1]?.meta.changes ?? 0) > 0) {
        return { ok: true, kind: "user-suspended" };
      }
      const current = await findUser(options.db, input.userId);
      if (!input.recentlyAuthenticated && current?.role === "administrator") {
        return { ok: false, kind: "reauthentication-required" };
      }
      return {
        ok: false,
        kind: stored.role === "administrator" ? "last-active-administrator" : "user-not-found",
      };
    },

    async reactivateUser(
      input: Readonly<{ actorId: string; userId: string }>,
    ): Promise<
      | Readonly<{ ok: true; kind: "user-reactivated"; user: User }>
      | Readonly<{ ok: false; kind: "user-not-found" }>
    > {
      const stored = await findUser(options.db, input.userId);
      if (!stored || stored.state !== "suspended") {
        return { ok: false, kind: "user-not-found" };
      }
      const occurredAt = now().getTime();
      const metadata = JSON.stringify({
        fromUserState: "suspended",
        toUserState: "active",
      });
      const results = await options.db.batch([
        options.db
          .prepare(
            `INSERT INTO audit_events
               (id, actor_id, action, subject_id, occurred_at, metadata)
             SELECT ?, ?, 'user-reactivate', id, ?, ?
             FROM users WHERE id = ? AND state = 'suspended'`,
          )
          .bind(randomId(), input.actorId, occurredAt, metadata, input.userId),
        options.db
          .prepare(
            `UPDATE users SET state = 'active', updated_at = ?
             WHERE id = ? AND state = 'suspended'`,
          )
          .bind(occurredAt, input.userId),
      ]);
      if ((results[1]?.meta.changes ?? 0) === 0) {
        return { ok: false, kind: "user-not-found" };
      }
      return {
        ok: true,
        kind: "user-reactivated",
        user: { ...stored, state: "active" },
      };
    },

    async issuePasswordReset(
      input: Readonly<{ actorId: string; userId: string }>,
    ): Promise<
      PasswordResetResult | Readonly<{ ok: false; kind: "user-not-found" | "user-suspended" }>
    > {
      const user = await findUser(options.db, input.userId);
      if (!user || user.state === "invited") {
        return { ok: false, kind: "user-not-found" };
      }
      if (user.state === "suspended") {
        return { ok: false, kind: "user-suspended" };
      }
      const occurredAt = now().getTime();
      const expiresAt = new Date(occurredAt + passwordResetDuration);
      const token = randomToken();
      await options.db.batch([
        options.db.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(user.id),
        options.db
          .prepare(
            `INSERT INTO password_resets (id, user_id, token_hash, issued_at, expires_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(randomId(), user.id, await hashToken(token), occurredAt, expiresAt.getTime()),
        options.db
          .prepare(
            `INSERT INTO audit_events
               (id, actor_id, action, subject_id, occurred_at, metadata)
             VALUES (?, ?, 'password-reset-issue', ?, ?, '{}')`,
          )
          .bind(randomId(), input.actorId, user.id, occurredAt),
      ]);
      return {
        ok: true,
        kind: "password-reset",
        passwordReset: { user, token, expiresAt },
      };
    },

    async usePasswordReset(
      input: Readonly<{ token: string; password: string }>,
    ): Promise<
      TokenFailure | PasswordFailure | Readonly<{ ok: true; kind: "password-reset"; user: User }>
    > {
      const occurredAt = now().getTime();
      const tokenHash = await hashToken(input.token);
      const user = await options.db
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
      if (!user) {
        return { ok: false, kind: "invalid-or-expired-token" };
      }
      const verifier = await createPasswordVerifier(input.password);
      if (!verifier) {
        return { ok: false, kind: "invalid-password" };
      }

      const tokenCondition = `EXISTS (
        SELECT 1 FROM password_resets
        WHERE user_id = ? AND token_hash = ? AND expires_at > ?
      )`;
      const results = await options.db.batch([
        options.db
          .prepare(
            `INSERT INTO audit_events
               (id, actor_id, action, subject_id, occurred_at, metadata)
             SELECT ?, id, 'password-reset-use', id, ?, '{}'
             FROM users
             WHERE id = ? AND state = 'active' AND ${tokenCondition}`,
          )
          .bind(randomId(), occurredAt, user.id, user.id, tokenHash, occurredAt),
        options.db
          .prepare(
            `UPDATE credentials SET verifier = ?, updated_at = ?
             WHERE user_id = ? AND ${tokenCondition}`,
          )
          .bind(verifier, occurredAt, user.id, user.id, tokenHash, occurredAt),
        options.db
          .prepare(
            `DELETE FROM sessions
             WHERE user_id = ? AND ${tokenCondition}`,
          )
          .bind(user.id, user.id, tokenHash, occurredAt),
        options.db
          .prepare(
            `DELETE FROM password_resets
             WHERE user_id = ? AND token_hash = ? AND expires_at > ?`,
          )
          .bind(user.id, tokenHash, occurredAt),
      ]);
      if ((results[3]?.meta.changes ?? 0) === 0) {
        return { ok: false, kind: "invalid-or-expired-token" };
      }
      return { ok: true, kind: "password-reset", user };
    },

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

    async writeOperatorRecovery(
      input: Readonly<{ email: string; token: string; expiresAt: Date }>,
    ): Promise<void> {
      const email = parseUserEmail(input.email);
      if (!email) {
        throw new Error("Active Administrator not found");
      }
      const user = await options.db
        .prepare(
          `SELECT id, display_email AS email, role, state
           FROM users
           WHERE normalized_email = ?
             AND state = 'active'
             AND role = 'administrator'`,
        )
        .bind(email.normalized)
        .first<User>();
      if (!user) {
        throw new Error("Active Administrator not found");
      }
      const occurredAt = now().getTime();
      await options.db.batch([
        options.db.prepare("DELETE FROM operator_recovery WHERE singleton_key = 1"),
        options.db
          .prepare(
            `INSERT INTO operator_recovery
               (singleton_key, user_id, token_hash, created_at, expires_at)
             VALUES (1, ?, ?, ?, ?)`,
          )
          .bind(user.id, await hashToken(input.token), occurredAt, input.expiresAt.getTime()),
      ]);
    },

    async useOperatorRecovery(
      input: Readonly<{ token: string; password: string }>,
    ): Promise<
      TokenFailure | PasswordFailure | Readonly<{ ok: true; kind: "operator-recovery"; user: User }>
    > {
      const occurredAt = now().getTime();
      const tokenHash = await hashToken(input.token);
      const user = await options.db
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
      if (!user) {
        return { ok: false, kind: "invalid-or-expired-token" };
      }
      const verifier = await createPasswordVerifier(input.password);
      if (!verifier) {
        return { ok: false, kind: "invalid-password" };
      }
      const recoveryCondition = `EXISTS (
        SELECT 1 FROM operator_recovery
        WHERE singleton_key = 1
          AND user_id = ?
          AND token_hash = ?
          AND expires_at > ?
      )`;
      const results = await options.db.batch([
        options.db
          .prepare(
            `INSERT INTO audit_events
               (id, actor_id, action, subject_id, occurred_at, metadata)
             SELECT ?, 'system', 'operator-recovery', id, ?, '{}'
             FROM users
             WHERE id = ? AND state = 'active' AND role = 'administrator'
               AND ${recoveryCondition}`,
          )
          .bind(randomId(), occurredAt, user.id, user.id, tokenHash, occurredAt),
        options.db
          .prepare(
            `UPDATE credentials SET verifier = ?, updated_at = ?
             WHERE user_id = ? AND ${recoveryCondition}`,
          )
          .bind(verifier, occurredAt, user.id, user.id, tokenHash, occurredAt),
        options.db
          .prepare(
            `DELETE FROM sessions
             WHERE user_id = ? AND ${recoveryCondition}`,
          )
          .bind(user.id, user.id, tokenHash, occurredAt),
        options.db
          .prepare(
            `DELETE FROM operator_recovery
             WHERE singleton_key = 1 AND user_id = ?
               AND token_hash = ? AND expires_at > ?`,
          )
          .bind(user.id, tokenHash, occurredAt),
      ]);
      if ((results[3]?.meta.changes ?? 0) === 0) {
        return { ok: false, kind: "invalid-or-expired-token" };
      }
      return { ok: true, kind: "operator-recovery", user };
    },
  };
}
