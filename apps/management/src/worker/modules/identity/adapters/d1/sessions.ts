import { databaseSchema, type ShortflareDatabase } from "@shortflare/database/d1";
import { and, eq, gt, sql } from "drizzle-orm";

import type {
  CredentialUser,
  OpenedSession,
  ReauthenticationSession,
  RequestSession,
  SessionPersistence,
} from "../../application/sessions";
import { changed, first, toDate, userSelection } from "./shared";

export function createD1SessionPersistence(database: ShortflareDatabase): SessionPersistence {
  return {
    async findCredentialByEmail(normalizedEmail) {
      return first(
        await database
          .select({ ...userSelection, verifier: databaseSchema.credentials.verifier })
          .from(databaseSchema.users)
          .leftJoin(
            databaseSchema.credentials,
            eq(databaseSchema.credentials.userId, databaseSchema.users.id),
          )
          .where(eq(databaseSchema.users.normalizedEmail, normalizedEmail))
          .limit(1),
      ) satisfies CredentialUser | null;
    },
    async updateVerifier(userId, verifier, occurredAt) {
      await database
        .update(databaseSchema.credentials)
        .set({ verifier, updatedAt: toDate(occurredAt) })
        .where(eq(databaseSchema.credentials.userId, userId));
    },
    async create(input) {
      await database.insert(databaseSchema.sessions).values({
        id: input.sessionId,
        userId: input.userId,
        tokenHash: input.tokenHash,
        csrfToken: input.csrfToken,
        createdAt: toDate(input.occurredAt),
        lastSeenAt: toDate(input.occurredAt),
        idleExpiresAt: toDate(input.idleExpiresAt),
        absoluteExpiresAt: toDate(input.absoluteExpiresAt),
        recentAuthenticationAt: toDate(input.occurredAt),
      });
    },
    async findActiveUser(tokenHash, occurredAt) {
      return first(
        await database
          .select(userSelection)
          .from(databaseSchema.sessions)
          .innerJoin(
            databaseSchema.users,
            eq(databaseSchema.users.id, databaseSchema.sessions.userId),
          )
          .where(
            and(
              eq(databaseSchema.sessions.tokenHash, tokenHash),
              gt(databaseSchema.sessions.idleExpiresAt, toDate(occurredAt)),
              gt(databaseSchema.sessions.absoluteExpiresAt, toDate(occurredAt)),
              eq(databaseSchema.users.state, "active"),
            ),
          )
          .limit(1),
      );
    },
    async findRequest(tokenHash, occurredAt) {
      const row = first(
        await database
          .select({
            ...userSelection,
            csrfToken: databaseSchema.sessions.csrfToken,
            lastSeenAt: databaseSchema.sessions.lastSeenAt,
            absoluteExpiresAt: databaseSchema.sessions.absoluteExpiresAt,
            recentAuthenticationAt: databaseSchema.sessions.recentAuthenticationAt,
          })
          .from(databaseSchema.sessions)
          .innerJoin(
            databaseSchema.users,
            eq(databaseSchema.users.id, databaseSchema.sessions.userId),
          )
          .where(
            and(
              eq(databaseSchema.sessions.tokenHash, tokenHash),
              gt(databaseSchema.sessions.idleExpiresAt, toDate(occurredAt)),
              gt(databaseSchema.sessions.absoluteExpiresAt, toDate(occurredAt)),
              eq(databaseSchema.users.state, "active"),
            ),
          )
          .limit(1),
      );
      return row === null ? null : toRequestSession(row);
    },
    async refresh(input) {
      await database
        .update(databaseSchema.sessions)
        .set({
          lastSeenAt: toDate(input.occurredAt),
          idleExpiresAt: toDate(input.idleExpiresAt),
        })
        .where(
          and(
            eq(databaseSchema.sessions.tokenHash, input.tokenHash),
            eq(databaseSchema.sessions.lastSeenAt, toDate(input.expectedLastSeenAt)),
          ),
        );
    },
    async open(tokenHash, occurredAt) {
      const row = first(
        await database
          .select({
            ...userSelection,
            csrfToken: databaseSchema.sessions.csrfToken,
            absoluteExpiresAt: databaseSchema.sessions.absoluteExpiresAt,
          })
          .from(databaseSchema.sessions)
          .innerJoin(
            databaseSchema.users,
            eq(databaseSchema.users.id, databaseSchema.sessions.userId),
          )
          .where(
            and(
              eq(databaseSchema.sessions.tokenHash, tokenHash),
              gt(databaseSchema.sessions.idleExpiresAt, toDate(occurredAt)),
              gt(databaseSchema.sessions.absoluteExpiresAt, toDate(occurredAt)),
              eq(databaseSchema.users.state, "active"),
            ),
          )
          .limit(1),
      );
      return row === null
        ? null
        : ({ ...row, absoluteExpiresAt: row.absoluteExpiresAt.getTime() } satisfies OpenedSession);
    },
    async findForReauthentication(tokenHash, occurredAt) {
      const row = first(
        await database
          .select({
            ...userSelection,
            sessionId: databaseSchema.sessions.id,
            absoluteExpiresAt: databaseSchema.sessions.absoluteExpiresAt,
            verifier: databaseSchema.credentials.verifier,
          })
          .from(databaseSchema.sessions)
          .innerJoin(
            databaseSchema.users,
            eq(databaseSchema.users.id, databaseSchema.sessions.userId),
          )
          .innerJoin(
            databaseSchema.credentials,
            eq(databaseSchema.credentials.userId, databaseSchema.users.id),
          )
          .where(
            and(
              eq(databaseSchema.sessions.tokenHash, tokenHash),
              gt(databaseSchema.sessions.idleExpiresAt, toDate(occurredAt)),
              gt(databaseSchema.sessions.absoluteExpiresAt, toDate(occurredAt)),
              eq(databaseSchema.users.state, "active"),
            ),
          )
          .limit(1),
      );
      return row === null
        ? null
        : ({
            ...row,
            absoluteExpiresAt: row.absoluteExpiresAt.getTime(),
          } satisfies ReauthenticationSession);
    },
    async rotate(input) {
      await database
        .update(databaseSchema.sessions)
        .set({
          tokenHash: input.tokenHash,
          csrfToken: input.csrfToken,
          lastSeenAt: toDate(input.occurredAt),
          idleExpiresAt: toDate(input.idleExpiresAt),
          recentAuthenticationAt: toDate(input.occurredAt),
        })
        .where(eq(databaseSchema.sessions.id, input.sessionId));
    },
    async findCredentialByUserId(userId) {
      return first(
        await database
          .select({ ...userSelection, verifier: databaseSchema.credentials.verifier })
          .from(databaseSchema.users)
          .innerJoin(
            databaseSchema.credentials,
            eq(databaseSchema.credentials.userId, databaseSchema.users.id),
          )
          .where(and(eq(databaseSchema.users.id, userId), eq(databaseSchema.users.state, "active")))
          .limit(1),
      );
    },
    async changePassword(input) {
      // Password replacement, its Audit Event, and revocation of every Session
      // are one D1 transaction, so all existing Sessions are revoked with it.
      const results = await database.batch([
        database.insert(databaseSchema.auditEvents).select(
          database
            .select({
              id: sql<string>`${input.auditId}`.as("id"),
              actorId: databaseSchema.users.id,
              action: sql<"password-change">`${"password-change"}`.as("action"),
              subjectId: databaseSchema.users.id,
              occurredAt: sql<Date>`${input.occurredAt}`.as("occurred_at"),
              metadata: sql<Record<string, never>>`${JSON.stringify({})}`.as("metadata"),
            })
            .from(databaseSchema.users)
            .where(
              and(
                eq(databaseSchema.users.id, input.userId),
                eq(databaseSchema.users.state, "active"),
              ),
            ),
        ),
        database
          .update(databaseSchema.credentials)
          .set({ verifier: input.verifier, updatedAt: toDate(input.occurredAt) })
          .where(eq(databaseSchema.credentials.userId, input.userId)),
        database
          .delete(databaseSchema.sessions)
          .where(eq(databaseSchema.sessions.userId, input.userId)),
      ]);
      return changed(results, 1);
    },
    async delete(tokenHash) {
      await database
        .delete(databaseSchema.sessions)
        .where(eq(databaseSchema.sessions.tokenHash, tokenHash));
    },
  };
}

function toRequestSession(
  row: Omit<RequestSession, "absoluteExpiresAt" | "lastSeenAt" | "recentAuthenticationAt"> & {
    absoluteExpiresAt: Date;
    lastSeenAt: Date;
    recentAuthenticationAt: Date;
  },
): RequestSession {
  return {
    ...row,
    absoluteExpiresAt: row.absoluteExpiresAt.getTime(),
    lastSeenAt: row.lastSeenAt.getTime(),
    recentAuthenticationAt: row.recentAuthenticationAt.getTime(),
  };
}
