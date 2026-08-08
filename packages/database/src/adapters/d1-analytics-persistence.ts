import type {
  AnalyticsPersistence,
  ClickEvent,
  PersistedIngestionResult,
} from "@shortflare/analytics";
import { halfHourBucket, sameClickEvent } from "@shortflare/analytics/event-policy";
import { and, gte, inArray, lt, sql } from "drizzle-orm";

import { createD1Database } from "../d1";
import * as databaseSchema from "../schema";
import type { ShortflareDatabase } from "../d1";
import { executeD1Analytics } from "./d1-analytics-maintenance";
import { queryD1Analytics } from "./d1-analytics-query";
import { aggregateEvents, chunks, storedEvent, uniqueKey } from "./d1-analytics-rollups";

export function createD1AnalyticsPersistence(binding: D1Database): AnalyticsPersistence {
  const database = createD1Database(binding);
  return {
    ingest: (events, ingestedAt) => ingest(database, events, ingestedAt),
    query: (query) => queryD1Analytics(database, query),
    execute: (command) => executeD1Analytics(database, command),
  };
}

async function ingest(
  database: ShortflareDatabase,
  inputs: readonly ClickEvent[],
  ingestedAt: Date,
): Promise<readonly PersistedIngestionResult[]> {
  if (inputs.length === 0) {
    return [];
  }
  const [existingRows, destinationRows] = await Promise.all([
    database
      .select()
      .from(databaseSchema.analyticsEvents)
      .where(
        inArray(
          databaseSchema.analyticsEvents.id,
          inputs.map(({ eventId }) => eventId),
        ),
      ),
    database
      .select({
        id: databaseSchema.destinationVersions.id,
        linkId: databaseSchema.destinationVersions.linkId,
      })
      .from(databaseSchema.destinationVersions)
      .where(
        inArray(
          databaseSchema.destinationVersions.id,
          inputs.map(({ destinationVersionId }) => destinationVersionId),
        ),
      ),
  ]);
  const known = new Map(existingRows.map((row) => [row.id, storedEvent(row)]));
  const destinationLinks = new Map(destinationRows.map((row) => [row.id, row.linkId]));
  const newEvents: ClickEvent[] = [];
  const results: PersistedIngestionResult[] = [];
  for (const event of inputs) {
    if (destinationLinks.get(event.destinationVersionId) !== event.linkId) {
      results.push({ kind: "invalid-reference", eventId: event.eventId });
      continue;
    }
    const existing = known.get(event.eventId);
    if (existing !== undefined) {
      results.push({
        kind: sameClickEvent(existing, event) ? "duplicate" : "integrity-conflict",
        eventId: event.eventId,
      });
      continue;
    }
    known.set(event.eventId, event);
    newEvents.push(event);
    results.push({ kind: "ingested", eventId: event.eventId });
  }
  if (newEvents.length === 0) {
    return results;
  }

  const linkIds = [...new Set(newEvents.map(({ linkId }) => linkId))];
  const halfHours = newEvents.map(({ occurredAt }) => halfHourBucket(new Date(occurredAt)));
  // The pre-read and rollup increment are safe because the Queue consumer is configured
  // with max_concurrency = 1. D1 batch rollback protects retries; ADR-0014 defines the
  // fixed-bucket uniqueness invariant that depends on this ordering.
  const existingUniques = await database
    .select()
    .from(databaseSchema.analyticsUniques)
    .where(
      and(
        inArray(databaseSchema.analyticsUniques.linkId, linkIds),
        gte(databaseSchema.analyticsUniques.halfHour, new Date(Math.min(...halfHours))),
        lt(databaseSchema.analyticsUniques.halfHour, new Date(Math.max(...halfHours) + 1)),
      ),
    );
  const uniqueKeys = new Set(existingUniques.map(uniqueKey));
  const { uniques, rollups } = aggregateEvents(newEvents, uniqueKeys);
  const rawRows = newEvents.map((event) => ({
    id: event.eventId,
    schemaVersion: event.schemaVersion,
    classificationVersion: event.classificationVersion,
    linkId: event.linkId,
    destinationVersionId: event.destinationVersionId,
    occurredAt: new Date(event.occurredAt),
    ingestedAt,
    pseudonymousVisitor: event.pseudonymousVisitor,
    botClassification: event.botClassification,
    referrerDomain: event.referrerDomain,
    country: event.country,
    deviceCategory: event.deviceCategory,
  }));
  const rawInserts = chunks(rawRows, 8).map((rows) =>
    database.insert(databaseSchema.analyticsEvents).values(rows),
  );
  const uniqueInserts = chunks(uniques, 10).map((rows) =>
    database.insert(databaseSchema.analyticsUniques).values(rows).onConflictDoNothing(),
  );
  const rollupInserts = chunks(rollups, 8).map((rows) =>
    database
      .insert(databaseSchema.analyticsRollups)
      .values(rows)
      .onConflictDoUpdate({
        target: [
          databaseSchema.analyticsRollups.scopeKind,
          databaseSchema.analyticsRollups.scopeId,
          databaseSchema.analyticsRollups.interval,
          databaseSchema.analyticsRollups.bucket,
          databaseSchema.analyticsRollups.dimension,
          databaseSchema.analyticsRollups.dimensionValue,
        ],
        set: {
          humanClicks: sql`${databaseSchema.analyticsRollups.humanClicks} + excluded.human_clicks`,
          uniqueHumanClicks: sql`${databaseSchema.analyticsRollups.uniqueHumanClicks} + excluded.unique_human_clicks`,
          suspectedBotClicks: sql`${databaseSchema.analyticsRollups.suspectedBotClicks} + excluded.suspected_bot_clicks`,
        },
      }),
  );
  const first = rawInserts[0];
  if (first === undefined) {
    throw new Error("New analytics events require a raw insert");
  }
  await database.batch([first, ...rawInserts.slice(1), ...uniqueInserts, ...rollupInserts]);
  return results;
}
