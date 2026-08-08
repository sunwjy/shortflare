import type { AnalyticsCommandResult, PersistenceCommand } from "@shortflare/analytics";
import { DAY_MS, RAW_RETENTION_MS } from "@shortflare/analytics/event-policy";
import { and, eq, gte, lt } from "drizzle-orm";

import type { ShortflareDatabase } from "../d1";
import * as databaseSchema from "../schema";
import { aggregateEvents, chunks, storedEvent } from "./d1-analytics-rollups";

export async function executeD1Analytics(
  database: ShortflareDatabase,
  command: PersistenceCommand,
): Promise<AnalyticsCommandResult> {
  if (command.kind === "expire") {
    const expired = await database
      .select({ id: databaseSchema.analyticsEvents.id })
      .from(databaseSchema.analyticsEvents)
      .where(lt(databaseSchema.analyticsEvents.occurredAt, command.rawBefore));
    await database.batch([
      database
        .delete(databaseSchema.analyticsRollups)
        .where(
          and(
            eq(databaseSchema.analyticsRollups.interval, "hour"),
            lt(databaseSchema.analyticsRollups.bucket, command.hourlyBefore),
          ),
        ),
      database
        .delete(databaseSchema.analyticsUniques)
        .where(lt(databaseSchema.analyticsUniques.halfHour, command.rawBefore)),
      database
        .delete(databaseSchema.analyticsEvents)
        .where(lt(databaseSchema.analyticsEvents.occurredAt, command.rawBefore)),
    ]);
    return { kind: "completed", affectedEvents: expired.length };
  }
  if (command.kind === "recalculate") {
    return recalculate(database, command);
  }
  return erase(database, command);
}

async function recalculate(
  database: ShortflareDatabase,
  command: Extract<PersistenceCommand, { kind: "recalculate" }>,
): Promise<AnalyticsCommandResult> {
  if (command.date.getTime() < command.occurredAt.getTime() - RAW_RETENTION_MS) {
    return { kind: "incomplete-raw" };
  }
  const end = new Date(command.date.getTime() + DAY_MS);
  const rawRows = await database
    .select()
    .from(databaseSchema.analyticsEvents)
    .where(
      and(
        eq(databaseSchema.analyticsEvents.linkId, command.linkId),
        gte(databaseSchema.analyticsEvents.occurredAt, command.date),
        lt(databaseSchema.analyticsEvents.occurredAt, end),
      ),
    );
  const derivedRows = await database
    .select({ scopeId: databaseSchema.analyticsRollups.scopeId })
    .from(databaseSchema.analyticsRollups)
    .where(
      and(
        eq(databaseSchema.analyticsRollups.linkId, command.linkId),
        gte(databaseSchema.analyticsRollups.bucket, command.date),
        lt(databaseSchema.analyticsRollups.bucket, end),
      ),
    )
    .limit(1);
  if (rawRows.length === 0 && derivedRows.length === 0) {
    return { kind: "completed", affectedEvents: 0 };
  }
  const { uniques, rollups } = aggregateEvents(rawRows.map(storedEvent), new Set());
  const uniqueInserts = chunks(uniques, 10).map((rows) =>
    database.insert(databaseSchema.analyticsUniques).values(rows),
  );
  const rollupInserts = chunks(rollups, 8).map((rows) =>
    database.insert(databaseSchema.analyticsRollups).values(rows),
  );
  await database.batch([
    database
      .delete(databaseSchema.analyticsRollups)
      .where(
        and(
          eq(databaseSchema.analyticsRollups.linkId, command.linkId),
          gte(databaseSchema.analyticsRollups.bucket, command.date),
          lt(databaseSchema.analyticsRollups.bucket, end),
        ),
      ),
    database
      .delete(databaseSchema.analyticsUniques)
      .where(
        and(
          eq(databaseSchema.analyticsUniques.linkId, command.linkId),
          gte(databaseSchema.analyticsUniques.halfHour, command.date),
          lt(databaseSchema.analyticsUniques.halfHour, end),
        ),
      ),
    ...uniqueInserts,
    ...rollupInserts,
    database.insert(databaseSchema.auditEvents).values({
      id: command.auditId,
      actorId: command.actor.id,
      action: "analytics-recalculate",
      subjectId: command.linkId,
      occurredAt: command.occurredAt,
      metadata: { analyticsDate: command.date.toISOString() },
    }),
  ]);
  return {
    kind: "completed",
    affectedEvents: rawRows.length,
    auditId: command.auditId,
  };
}

async function erase(
  database: ShortflareDatabase,
  command: Extract<PersistenceCommand, { kind: "erase" }>,
): Promise<AnalyticsCommandResult> {
  const eventCondition =
    command.scope.kind === "instance"
      ? undefined
      : eq(databaseSchema.analyticsEvents.linkId, command.scope.linkId);
  const affected = await database
    .select({ id: databaseSchema.analyticsEvents.id })
    .from(databaseSchema.analyticsEvents)
    .where(eventCondition);
  const rollupCondition =
    command.scope.kind === "instance"
      ? undefined
      : eq(databaseSchema.analyticsRollups.linkId, command.scope.linkId);
  const retainedRollups = await database
    .select({ scopeId: databaseSchema.analyticsRollups.scopeId })
    .from(databaseSchema.analyticsRollups)
    .where(rollupCondition)
    .limit(1);
  if (affected.length === 0 && retainedRollups.length === 0) {
    return { kind: "completed", affectedEvents: 0 };
  }
  const uniqueCondition =
    command.scope.kind === "instance"
      ? undefined
      : eq(databaseSchema.analyticsUniques.linkId, command.scope.linkId);
  await database.batch([
    database.delete(databaseSchema.analyticsRollups).where(rollupCondition),
    database.delete(databaseSchema.analyticsUniques).where(uniqueCondition),
    database.delete(databaseSchema.analyticsEvents).where(eventCondition),
    database.insert(databaseSchema.auditEvents).values({
      id: command.auditId,
      actorId: command.actor.id,
      action: "analytics-erase",
      subjectId: command.scope.kind === "instance" ? "instance" : command.scope.linkId,
      occurredAt: command.occurredAt,
      metadata: {},
    }),
  ]);
  return {
    kind: "completed",
    affectedEvents: affected.length,
    auditId: command.auditId,
  };
}
