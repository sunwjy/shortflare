import { databaseSchema, type ShortflareDatabase } from "@shortflare/database/d1";
import { and, eq, exists, gt, sql } from "drizzle-orm";

import type { PasswordResetPersistence } from "../../application/password-resets";
import { changed, first, toDate, userSelection } from "./shared";

export function createD1PasswordResetPersistence(
  database: ShortflareDatabase,
): PasswordResetPersistence {
  return {
    async findUser(userId) {
      return first(
        await database
          .select(userSelection)
          .from(databaseSchema.users)
          .where(eq(databaseSchema.users.id, userId))
          .limit(1),
      );
    },

    async issue(input) {
      await database.batch([
        database
          .delete(databaseSchema.passwordResets)
          .where(eq(databaseSchema.passwordResets.userId, input.userId)),
        database.insert(databaseSchema.passwordResets).values({
          id: input.resetId,
          userId: input.userId,
          tokenHash: input.tokenHash,
          issuedAt: toDate(input.occurredAt),
          expiresAt: toDate(input.expiresAt),
        }),
        database.insert(databaseSchema.auditEvents).values({
          id: input.auditId,
          actorId: input.actorId,
          action: "password-reset-issue",
          subjectId: input.userId,
          occurredAt: toDate(input.occurredAt),
          metadata: {},
        }),
      ]);
    },

    async findActiveUserByToken(tokenHash, occurredAt) {
      return first(
        await database
          .select(userSelection)
          .from(databaseSchema.passwordResets)
          .innerJoin(
            databaseSchema.users,
            eq(databaseSchema.users.id, databaseSchema.passwordResets.userId),
          )
          .where(
            and(
              eq(databaseSchema.passwordResets.tokenHash, tokenHash),
              gt(databaseSchema.passwordResets.expiresAt, toDate(occurredAt)),
              eq(databaseSchema.users.state, "active"),
            ),
          )
          .limit(1),
      );
    },

    async use(input) {
      // Every side effect is conditional on the same live token, and the final
      // delete consumes it in the batch with the password change and revocations.
      const liveToken = database
        .select({ value: sql`1` })
        .from(databaseSchema.passwordResets)
        .where(
          and(
            eq(databaseSchema.passwordResets.userId, input.userId),
            eq(databaseSchema.passwordResets.tokenHash, input.tokenHash),
            gt(databaseSchema.passwordResets.expiresAt, toDate(input.occurredAt)),
          ),
        );
      const results = await database.batch([
        database.insert(databaseSchema.auditEvents).select(
          database
            .select({
              id: sql<string>`${input.auditId}`.as("id"),
              actorId: databaseSchema.users.id,
              action: sql<"password-reset-use">`${"password-reset-use"}`.as("action"),
              subjectId: databaseSchema.users.id,
              occurredAt: sql<Date>`${input.occurredAt}`.as("occurred_at"),
              metadata: sql<Record<string, never>>`${JSON.stringify({})}`.as("metadata"),
            })
            .from(databaseSchema.users)
            .where(
              and(
                eq(databaseSchema.users.id, input.userId),
                eq(databaseSchema.users.state, "active"),
                exists(liveToken),
              ),
            ),
        ),
        database
          .update(databaseSchema.credentials)
          .set({ verifier: input.verifier, updatedAt: toDate(input.occurredAt) })
          .where(and(eq(databaseSchema.credentials.userId, input.userId), exists(liveToken))),
        database
          .delete(databaseSchema.sessions)
          .where(and(eq(databaseSchema.sessions.userId, input.userId), exists(liveToken))),
        database
          .delete(databaseSchema.passwordResets)
          .where(
            and(
              eq(databaseSchema.passwordResets.userId, input.userId),
              eq(databaseSchema.passwordResets.tokenHash, input.tokenHash),
              gt(databaseSchema.passwordResets.expiresAt, toDate(input.occurredAt)),
            ),
          ),
      ]);
      return changed(results, 3);
    },
  };
}
