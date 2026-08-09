import { createD1Database, databaseSchema } from "@shortflare/database/d1";
import { and, asc, desc, eq, gt, gte, inArray, lt, or } from "drizzle-orm";

import type { AuditEventPersistence, PersistedAuditEvent } from "../application/audit-events";

export function createD1AuditEventPersistence(binding: D1Database): AuditEventPersistence {
  const database = createD1Database(binding);
  return {
    async list(query) {
      const conditions = [
        gte(databaseSchema.auditEvents.occurredAt, query.start),
        lt(databaseSchema.auditEvents.occurredAt, query.end),
        ...(query.actorId === undefined
          ? []
          : [eq(databaseSchema.auditEvents.actorId, query.actorId)]),
        ...(query.actions === undefined
          ? []
          : [inArray(databaseSchema.auditEvents.action, query.actions)]),
        ...(query.subjectId === undefined
          ? []
          : [eq(databaseSchema.auditEvents.subjectId, query.subjectId)]),
        ...(query.after === undefined
          ? []
          : [
              or(
                lt(databaseSchema.auditEvents.occurredAt, query.after.occurredAt),
                and(
                  eq(databaseSchema.auditEvents.occurredAt, query.after.occurredAt),
                  gt(databaseSchema.auditEvents.id, query.after.id),
                ),
              ),
            ]),
      ];
      const rows = await database
        .select()
        .from(databaseSchema.auditEvents)
        .where(and(...conditions))
        .orderBy(desc(databaseSchema.auditEvents.occurredAt), asc(databaseSchema.auditEvents.id))
        .limit(query.limit);
      return enrichIdentifiers(database, rows);
    },
  };
}

type Database = ReturnType<typeof createD1Database>;
type AuditRow = typeof databaseSchema.auditEvents.$inferSelect;

async function enrichIdentifiers(
  database: Database,
  rows: readonly AuditRow[],
): Promise<readonly PersistedAuditEvent[]> {
  const ids = [...new Set(rows.flatMap((row) => [row.actorId, row.subjectId]))];
  if (ids.length === 0) return [];
  const [users, aliases] = await Promise.all([
    database
      .select({ id: databaseSchema.users.id, display: databaseSchema.users.displayEmail })
      .from(databaseSchema.users)
      .where(inArray(databaseSchema.users.id, ids)),
    database
      .select({
        alias: databaseSchema.aliases.alias,
        linkId: databaseSchema.aliases.linkId,
        deletedLinkId: databaseSchema.aliases.deletedLinkId,
      })
      .from(databaseSchema.aliases)
      .where(
        or(
          inArray(databaseSchema.aliases.linkId, ids),
          inArray(databaseSchema.aliases.deletedLinkId, ids),
        ),
      ),
  ]);
  const userDisplay = new Map(users.map((user) => [user.id, user.display]));
  const linkDisplay = new Map(
    aliases.flatMap((alias) => {
      const id = alias.linkId ?? alias.deletedLinkId;
      return id === null ? [] : [[id, alias.alias] as const];
    }),
  );
  return rows.map((row) => ({
    id: row.id,
    actorId: row.actorId,
    actorDisplay: userDisplay.get(row.actorId) ?? null,
    action: row.action,
    subjectId: row.subjectId,
    subjectDisplay: userDisplay.get(row.subjectId) ?? linkDisplay.get(row.subjectId) ?? null,
    occurredAt: row.occurredAt,
    metadata: row.metadata,
  }));
}
