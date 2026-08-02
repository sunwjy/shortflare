import type { CreateSessionRecord, CredentialUser, SessionPersistence } from "./sessions";
import type { User } from "./shared";

type StoredSession = CreateSessionRecord &
  Readonly<{ lastSeenAt: number; recentAuthenticationAt: number }>;

export function createInMemorySessionPersistence(
  seed: readonly CredentialUser[],
): SessionPersistence {
  const users = new Map(seed.map((user) => [user.id, structuredClone(user)]));
  const sessions = new Map<string, StoredSession>();

  function activeSession(tokenHash: string, occurredAt: number) {
    const session = [...sessions.values()].find(
      (candidate) =>
        candidate.tokenHash === tokenHash &&
        candidate.idleExpiresAt > occurredAt &&
        candidate.absoluteExpiresAt > occurredAt,
    );
    const user = session ? users.get(session.userId) : undefined;
    return session && user?.state === "active" ? { session, user } : null;
  }

  return {
    async findCredentialByEmail(normalizedEmail) {
      return (
        [...users.values()].find((user) => user.email.toLowerCase() === normalizedEmail) ?? null
      );
    },
    async updateVerifier(userId, verifier) {
      const user = users.get(userId);
      if (user) users.set(userId, { ...user, verifier });
    },
    async create(input) {
      sessions.set(input.sessionId, {
        ...input,
        lastSeenAt: input.occurredAt,
        recentAuthenticationAt: input.occurredAt,
      });
    },
    async findActiveUser(tokenHash, occurredAt) {
      return activeSession(tokenHash, occurredAt)?.user ?? null;
    },
    async findRequest(tokenHash, occurredAt) {
      const found = activeSession(tokenHash, occurredAt);
      return found
        ? {
            ...found.user,
            absoluteExpiresAt: found.session.absoluteExpiresAt,
            csrfToken: found.session.csrfToken,
            lastSeenAt: found.session.lastSeenAt,
            recentAuthenticationAt: found.session.recentAuthenticationAt,
          }
        : null;
    },
    async refresh(input) {
      const found = [...sessions.entries()].find(
        ([, session]) =>
          session.tokenHash === input.tokenHash && session.lastSeenAt === input.expectedLastSeenAt,
      );
      if (found) {
        sessions.set(found[0], {
          ...found[1],
          idleExpiresAt: input.idleExpiresAt,
          lastSeenAt: input.occurredAt,
        });
      }
    },
    async open(tokenHash, occurredAt) {
      const found = activeSession(tokenHash, occurredAt);
      return found
        ? {
            ...found.user,
            absoluteExpiresAt: found.session.absoluteExpiresAt,
            csrfToken: found.session.csrfToken,
          }
        : null;
    },
    async findForReauthentication(tokenHash, occurredAt) {
      const found = activeSession(tokenHash, occurredAt);
      return found && found.user.verifier
        ? {
            ...found.user,
            absoluteExpiresAt: found.session.absoluteExpiresAt,
            sessionId: found.session.sessionId,
            verifier: found.user.verifier,
          }
        : null;
    },
    async rotate(input) {
      const session = sessions.get(input.sessionId);
      if (session) {
        sessions.set(input.sessionId, {
          ...session,
          csrfToken: input.csrfToken,
          idleExpiresAt: input.idleExpiresAt,
          lastSeenAt: input.occurredAt,
          recentAuthenticationAt: input.occurredAt,
          tokenHash: input.tokenHash,
        });
      }
    },
    async findCredentialByUserId(userId) {
      const user = users.get(userId);
      return user?.state === "active" && user.verifier
        ? { ...user, verifier: user.verifier }
        : null;
    },
    async changePassword(input) {
      const user = users.get(input.userId);
      if (!user) return false;
      users.set(input.userId, { ...user, verifier: input.verifier });
      for (const [sessionId, session] of sessions) {
        if (session.userId === input.userId) sessions.delete(sessionId);
      }
      return true;
    },
    async delete(tokenHash) {
      for (const [sessionId, session] of sessions) {
        if (session.tokenHash === tokenHash) sessions.delete(sessionId);
      }
    },
  };
}

export type InMemoryCredentialUser = User & Readonly<{ verifier: string }>;
