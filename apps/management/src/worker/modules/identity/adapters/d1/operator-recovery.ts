import { databaseSchema, type ShortflareDatabase } from "@shortflare/database/d1";
import { and, eq, exists, gt, sql } from "drizzle-orm";

import type { OperatorRecoveryPersistence } from "../../application/operator-recovery";
import { changed, first, toDate, userSelection } from "./shared";

export function createD1OperatorRecoveryPersistence(
  database: ShortflareDatabase,
): OperatorRecoveryPersistence {
  return {
    async findActiveAdministrator(normalizedEmail) {
      return first(
        await database
          .select(userSelection)
          .from(databaseSchema.users)
          .where(
            and(
              eq(databaseSchema.users.normalizedEmail, normalizedEmail),
              eq(databaseSchema.users.state, "active"),
              eq(databaseSchema.users.role, "administrator"),
            ),
          )
          .limit(1),
      );
    },
    async write(input) {
      await database.batch([
        database
          .delete(databaseSchema.operatorRecovery)
          .where(eq(databaseSchema.operatorRecovery.singletonKey, 1)),
        database.insert(databaseSchema.operatorRecovery).values({
          singletonKey: 1,
          userId: input.userId,
          tokenHash: input.tokenHash,
          createdAt: toDate(input.createdAt),
          expiresAt: toDate(input.expiresAt),
        }),
      ]);
    },
    async findActiveAdministratorByToken(tokenHash, occurredAt) {
      return first(
        await database
          .select(userSelection)
          .from(databaseSchema.operatorRecovery)
          .innerJoin(
            databaseSchema.users,
            eq(databaseSchema.users.id, databaseSchema.operatorRecovery.userId),
          )
          .where(
            and(
              eq(databaseSchema.operatorRecovery.singletonKey, 1),
              eq(databaseSchema.operatorRecovery.tokenHash, tokenHash),
              gt(databaseSchema.operatorRecovery.expiresAt, toDate(occurredAt)),
              eq(databaseSchema.users.state, "active"),
              eq(databaseSchema.users.role, "administrator"),
            ),
          )
          .limit(1),
      );
    },
    async use(input) {
      // ADR-0008 makes recovery a one-time atomic handoff. Repeating the token
      // condition prevents any side effect if the handoff expires or is consumed.
      const liveRecovery = database
        .select({ value: sql`1` })
        .from(databaseSchema.operatorRecovery)
        .where(
          and(
            eq(databaseSchema.operatorRecovery.singletonKey, 1),
            eq(databaseSchema.operatorRecovery.userId, input.userId),
            eq(databaseSchema.operatorRecovery.tokenHash, input.tokenHash),
            gt(databaseSchema.operatorRecovery.expiresAt, toDate(input.occurredAt)),
          ),
        );
      const results = await database.batch([
        database.insert(databaseSchema.auditEvents).select(
          database
            .select({
              id: sql<string>`${input.auditId}`.as("id"),
              actorId: sql<string>`${"system"}`.as("actor_id"),
              action: sql<"operator-recovery">`${"operator-recovery"}`.as("action"),
              subjectId: databaseSchema.users.id,
              occurredAt: sql<Date>`${input.occurredAt}`.as("occurred_at"),
              metadata: sql<Record<string, never>>`${JSON.stringify({})}`.as("metadata"),
            })
            .from(databaseSchema.users)
            .where(
              and(
                eq(databaseSchema.users.id, input.userId),
                eq(databaseSchema.users.state, "active"),
                eq(databaseSchema.users.role, "administrator"),
                exists(liveRecovery),
              ),
            ),
        ),
        database
          .update(databaseSchema.credentials)
          .set({ verifier: input.verifier, updatedAt: toDate(input.occurredAt) })
          .where(and(eq(databaseSchema.credentials.userId, input.userId), exists(liveRecovery))),
        database
          .delete(databaseSchema.sessions)
          .where(and(eq(databaseSchema.sessions.userId, input.userId), exists(liveRecovery))),
        database
          .delete(databaseSchema.operatorRecovery)
          .where(
            and(
              eq(databaseSchema.operatorRecovery.singletonKey, 1),
              eq(databaseSchema.operatorRecovery.userId, input.userId),
              eq(databaseSchema.operatorRecovery.tokenHash, input.tokenHash),
              gt(databaseSchema.operatorRecovery.expiresAt, toDate(input.occurredAt)),
            ),
          ),
      ]);
      return changed(results, 3);
    },
  };
}
