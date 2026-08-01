import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

import { createPasswordVerifier, dummyVerifier, verifyPassword } from "../passwords";
import { hashToken, parseUserEmail, toUser, type User } from "./shared";

const idleDuration = 7 * 24 * 60 * 60 * 1_000;
const absoluteDuration = 30 * 24 * 60 * 60 * 1_000;
const recentDuration = 10 * 60 * 1_000;
const refreshInterval = 60 * 60 * 1_000;

export type CredentialUser = User & Readonly<{ verifier: string | null }>;
export type RequestSession = User &
  Readonly<{
    absoluteExpiresAt: number;
    csrfToken: string;
    lastSeenAt: number;
    recentAuthenticationAt: number;
  }>;
export type OpenedSession = User & Readonly<{ absoluteExpiresAt: number; csrfToken: string }>;
export type ReauthenticationSession = User &
  Readonly<{ absoluteExpiresAt: number; sessionId: string; verifier: string }>;

export type SessionPersistence = {
  findCredentialByEmail(normalizedEmail: string): Promise<CredentialUser | null>;
  updateVerifier(userId: string, verifier: string, occurredAt: number): Promise<void>;
  create(input: CreateSessionRecord): Promise<void>;
  findActiveUser(tokenHash: string, occurredAt: number): Promise<User | null>;
  findRequest(tokenHash: string, occurredAt: number): Promise<RequestSession | null>;
  refresh(input: RefreshSessionRecord): Promise<void>;
  open(tokenHash: string, occurredAt: number): Promise<OpenedSession | null>;
  findForReauthentication(
    tokenHash: string,
    occurredAt: number,
  ): Promise<ReauthenticationSession | null>;
  rotate(input: RotateSessionRecord): Promise<void>;
  findCredentialByUserId(userId: string): Promise<(User & { verifier: string }) | null>;
  changePassword(input: ChangePasswordRecord): Promise<boolean>;
  delete(tokenHash: string): Promise<void>;
};

export type CreateSessionRecord = Readonly<{
  absoluteExpiresAt: number;
  csrfToken: string;
  idleExpiresAt: number;
  occurredAt: number;
  sessionId: string;
  tokenHash: string;
  userId: string;
}>;
export type RefreshSessionRecord = Readonly<{
  expectedLastSeenAt: number;
  idleExpiresAt: number;
  occurredAt: number;
  tokenHash: string;
}>;
export type RotateSessionRecord = Readonly<{
  csrfToken: string;
  idleExpiresAt: number;
  occurredAt: number;
  sessionId: string;
  tokenHash: string;
}>;
export type ChangePasswordRecord = Readonly<{
  auditId: string;
  occurredAt: number;
  userId: string;
  verifier: string;
}>;

/**
 * Owns Session lifetime, credential verification, CSRF, and recent-auth policy.
 * Persistence operations retain the atomic storage guarantees while this module
 * decides when a Session may be created, refreshed, rotated, or revoked.
 */
export function createSessions(
  persistence: SessionPersistence,
  dependencies: Readonly<{
    now: () => Date;
    randomId: () => string;
    randomToken: () => string;
  }>,
) {
  return {
    async login(input: Readonly<{ email: string; password: string }>) {
      const email = parseUserEmail(input.email);
      const record = email ? await persistence.findCredentialByEmail(email.normalized) : null;
      // Unknown accounts use a valid current-policy verifier so login does not
      // skip the expensive KDF and expose account existence through timing.
      const verification = await verifyPassword(input.password, record?.verifier ?? dummyVerifier);
      if (!record || record.state !== "active" || !record.verifier || !verification.valid) {
        return { ok: false, kind: "invalid-credentials" } as const;
      }

      const occurredAt = dependencies.now().getTime();
      if (verification.needsRehash) {
        const verifier = await createPasswordVerifier(input.password);
        if (!verifier) return { ok: false, kind: "invalid-credentials" } as const;
        await persistence.updateVerifier(record.id, verifier, occurredAt);
      }
      const token = dependencies.randomToken();
      const csrfToken = dependencies.randomToken();
      const expiresAt = new Date(occurredAt + absoluteDuration);
      await persistence.create({
        absoluteExpiresAt: expiresAt.getTime(),
        csrfToken,
        idleExpiresAt: occurredAt + idleDuration,
        occurredAt,
        sessionId: dependencies.randomId(),
        tokenHash: await hashToken(token),
        userId: record.id,
      });
      return sessionResult(token, csrfToken, expiresAt, record);
    },

    async authenticate(token: string) {
      const occurredAt = dependencies.now().getTime();
      const record = await persistence.findActiveUser(await hashToken(token), occurredAt);
      return record
        ? ({ ok: true, kind: "user", user: toUser(record) } as const)
        : ({ ok: false, kind: "invalid-credentials" } as const);
    },

    async authenticateRequest(
      token: string,
      csrfToken: string,
      requireRecentAuthentication = false,
    ) {
      const occurredAt = dependencies.now().getTime();
      const tokenHash = await hashToken(token);
      const record = await persistence.findRequest(tokenHash, occurredAt);
      if (!record) return { ok: false, kind: "invalid-credentials" } as const;
      if (!safeTokenEqual(record.csrfToken, csrfToken)) {
        return { ok: false, kind: "invalid-csrf-token" } as const;
      }

      const recentlyAuthenticated = occurredAt - record.recentAuthenticationAt <= recentDuration;
      if (requireRecentAuthentication && !recentlyAuthenticated) {
        return { ok: false, kind: "reauthentication-required" } as const;
      }
      if (occurredAt - record.lastSeenAt >= refreshInterval) {
        // The expected timestamp makes concurrent refreshes harmless, and the
        // idle extension is always capped by the original absolute lifetime.
        await persistence.refresh({
          expectedLastSeenAt: record.lastSeenAt,
          idleExpiresAt: Math.min(occurredAt + idleDuration, record.absoluteExpiresAt),
          occurredAt,
          tokenHash,
        });
      }
      return {
        ok: true,
        kind: "user",
        user: toUser(record),
        recentlyAuthenticated,
      } as const;
    },

    async openSession(token: string) {
      const record = await persistence.open(await hashToken(token), dependencies.now().getTime());
      return record
        ? sessionResult(token, record.csrfToken, new Date(record.absoluteExpiresAt), record)
        : ({ ok: false, kind: "invalid-credentials" } as const);
    },

    async reauthenticate(input: Readonly<{ token: string; password: string }>) {
      const occurredAt = dependencies.now().getTime();
      const record = await persistence.findForReauthentication(
        await hashToken(input.token),
        occurredAt,
      );
      const verification = record
        ? await verifyPassword(input.password, record.verifier)
        : undefined;
      if (!record || !verification?.valid) {
        return { ok: false, kind: "invalid-credentials" } as const;
      }

      const token = dependencies.randomToken();
      const csrfToken = dependencies.randomToken();
      // Reauthentication rotates both bearer secrets but preserves the Session's
      // identity and absolute expiry; recent auth must not extend total lifetime.
      await persistence.rotate({
        csrfToken,
        idleExpiresAt: Math.min(occurredAt + idleDuration, record.absoluteExpiresAt),
        occurredAt,
        sessionId: record.sessionId,
        tokenHash: await hashToken(token),
      });
      return sessionResult(token, csrfToken, new Date(record.absoluteExpiresAt), record);
    },

    async changePassword(
      input: Readonly<{ userId: string; currentPassword: string; password: string }>,
    ) {
      const record = await persistence.findCredentialByUserId(input.userId);
      const verification = record
        ? await verifyPassword(input.currentPassword, record.verifier)
        : undefined;
      if (!record || !verification?.valid) {
        return { ok: false, kind: "invalid-credentials" } as const;
      }
      const verifier = await createPasswordVerifier(input.password);
      if (!verifier) return { ok: false, kind: "invalid-password" } as const;

      const changed = await persistence.changePassword({
        auditId: dependencies.randomId(),
        occurredAt: dependencies.now().getTime(),
        userId: record.id,
        verifier,
      });
      return changed
        ? ({ ok: true, kind: "password-changed" } as const)
        : ({ ok: false, kind: "invalid-credentials" } as const);
    },

    async logout(token: string) {
      await persistence.delete(await hashToken(token));
      return { ok: true, kind: "logged-out" } as const;
    },
  };
}

function sessionResult(token: string, csrfToken: string, expiresAt: Date, user: User) {
  return {
    ok: true,
    kind: "session",
    session: { token, csrfToken, expiresAt, user: toUser(user) },
  } as const;
}

function safeTokenEqual(left: string, right: string) {
  return (
    Buffer.byteLength(left) === Buffer.byteLength(right) &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}
