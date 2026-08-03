import { databaseSchema, type ShortflareDatabase } from "@shortflare/database/d1";
import { and, asc, eq, exists, sql } from "drizzle-orm";

import type { UserPersistence } from "../../application/users";
import { changed, first, toDate, userSelection } from "./shared";

/**
 * Persists User lifecycle changes with their Audit Event and Session revocation.
 * Write-time guards enforce recent authentication and preserve at least one
 * Active Administrator without trusting an earlier application read.
 */
export function createD1UserPersistence(database: ShortflareDatabase): UserPersistence {
  return {
    list() {
      return database
        .select(userSelection)
        .from(databaseSchema.users)
        .orderBy(asc(databaseSchema.users.createdAt), asc(databaseSchema.users.id));
    },

    async find(userId) {
      return first(
        await database
          .select(userSelection)
          .from(databaseSchema.users)
          .where(eq(databaseSchema.users.id, userId))
          .limit(1),
      );
    },

    async changeRole(input) {
      const guard = sql`
        ${databaseSchema.users.id} = ${input.userId}
        AND ${databaseSchema.users.role} = ${input.storedRole}
        AND ${databaseSchema.users.state} IN ('active', 'suspended')
        AND (
          ${input.recentlyAuthenticated ? 1 : 0} = 1
          OR (${input.role} != 'administrator' AND ${databaseSchema.users.role} != 'administrator')
        )
        AND NOT (
          ${databaseSchema.users.state} = 'active'
          AND ${databaseSchema.users.role} = 'administrator'
          AND ${input.role} != 'administrator'
          AND (
            SELECT COUNT(*) FROM ${databaseSchema.users}
            WHERE ${databaseSchema.users.state} = 'active'
              AND ${databaseSchema.users.role} = 'administrator'
          ) = 1
        )
      `;
      const metadata = { fromRole: input.storedRole, toRole: input.role };
      // Audit insertion and mutation deliberately share the same guard. The D1
      // batch then makes the audit, state change, and Session revocation atomic.
      const changedUser = database
        .select({ value: sql`1` })
        .from(databaseSchema.users)
        .where(
          and(eq(databaseSchema.users.id, input.userId), eq(databaseSchema.users.role, input.role)),
        );
      const results = await database.batch([
        database.insert(databaseSchema.auditEvents).select(
          database
            .select({
              id: sql<string>`${input.auditId}`.as("id"),
              actorId: sql<string>`${input.actorId}`.as("actor_id"),
              action: sql<"role-change">`${"role-change"}`.as("action"),
              subjectId: databaseSchema.users.id,
              occurredAt: sql<Date>`${input.occurredAt}`.as("occurred_at"),
              metadata: sql<typeof metadata>`${JSON.stringify(metadata)}`.as("metadata"),
            })
            .from(databaseSchema.users)
            .where(guard),
        ),
        database
          .update(databaseSchema.users)
          .set({ role: input.role, updatedAt: toDate(input.occurredAt) })
          .where(guard),
        database
          .delete(databaseSchema.sessions)
          .where(and(eq(databaseSchema.sessions.userId, input.userId), exists(changedUser))),
      ]);
      return changed(results, 1);
    },

    async suspend(input) {
      const guard = sql`
        ${databaseSchema.users.id} = ${input.userId}
        AND ${databaseSchema.users.state} = 'active'
        AND (${input.recentlyAuthenticated ? 1 : 0} = 1
          OR ${databaseSchema.users.role} != 'administrator')
        AND NOT (
          ${databaseSchema.users.role} = 'administrator'
          AND (
            SELECT COUNT(*) FROM ${databaseSchema.users}
            WHERE ${databaseSchema.users.state} = 'active'
              AND ${databaseSchema.users.role} = 'administrator'
          ) = 1
        )
      `;
      const metadata = { fromUserState: "active" as const, toUserState: "suspended" as const };
      // Keep the protection predicate identical for the Audit Event and update;
      // otherwise a concurrent role change could make their outcomes disagree.
      const suspendedUser = database
        .select({ value: sql`1` })
        .from(databaseSchema.users)
        .where(
          and(
            eq(databaseSchema.users.id, input.userId),
            eq(databaseSchema.users.state, "suspended"),
          ),
        );
      const results = await database.batch([
        database.insert(databaseSchema.auditEvents).select(
          database
            .select({
              id: sql<string>`${input.auditId}`.as("id"),
              actorId: sql<string>`${input.actorId}`.as("actor_id"),
              action: sql<"user-suspend">`${"user-suspend"}`.as("action"),
              subjectId: databaseSchema.users.id,
              occurredAt: sql<Date>`${input.occurredAt}`.as("occurred_at"),
              metadata: sql<typeof metadata>`${JSON.stringify(metadata)}`.as("metadata"),
            })
            .from(databaseSchema.users)
            .where(guard),
        ),
        database
          .update(databaseSchema.users)
          .set({ state: "suspended", updatedAt: toDate(input.occurredAt) })
          .where(guard),
        database
          .delete(databaseSchema.sessions)
          .where(and(eq(databaseSchema.sessions.userId, input.userId), exists(suspendedUser))),
      ]);
      return changed(results, 1);
    },

    async reactivate(input) {
      const guard = and(
        eq(databaseSchema.users.id, input.userId),
        eq(databaseSchema.users.state, "suspended"),
      );
      const metadata = { fromUserState: "suspended" as const, toUserState: "active" as const };
      const results = await database.batch([
        database.insert(databaseSchema.auditEvents).select(
          database
            .select({
              id: sql<string>`${input.auditId}`.as("id"),
              actorId: sql<string>`${input.actorId}`.as("actor_id"),
              action: sql<"user-reactivate">`${"user-reactivate"}`.as("action"),
              subjectId: databaseSchema.users.id,
              occurredAt: sql<Date>`${input.occurredAt}`.as("occurred_at"),
              metadata: sql<typeof metadata>`${JSON.stringify(metadata)}`.as("metadata"),
            })
            .from(databaseSchema.users)
            .where(guard),
        ),
        database
          .update(databaseSchema.users)
          .set({ state: "active", updatedAt: toDate(input.occurredAt) })
          .where(guard),
      ]);
      return changed(results, 1);
    },
  };
}
