import type { ClickEvent } from "@shortflare/analytics";
import {
  eventDimensions,
  halfHourBucket,
  intervalBucket,
} from "@shortflare/analytics/event-policy";

import * as databaseSchema from "../schema";

type ScopeKind = "link" | "destination-version";
type RollupInsert = typeof databaseSchema.analyticsRollups.$inferInsert;
type UniqueInsert = typeof databaseSchema.analyticsUniques.$inferInsert;

export function aggregateEvents(events: readonly ClickEvent[], existingKeys: Set<string>) {
  const uniques: UniqueInsert[] = [];
  const rollupMap = new Map<string, RollupInsert>();
  for (const event of events) {
    const occurredAt = new Date(event.occurredAt);
    const scopes = [scope(event, "link"), scope(event, "destination-version")] as const;
    for (const currentScope of scopes) {
      for (const { dimension, value: dimensionValue, uniqueEligible } of eventDimensions(event)) {
        let isUnique = false;
        if (uniqueEligible) {
          const unique: UniqueInsert = {
            ...currentScope,
            halfHour: new Date(halfHourBucket(occurredAt)),
            dimension,
            dimensionValue,
            pseudonymousVisitor: event.pseudonymousVisitor,
          };
          const key = uniqueKey(unique);
          isUnique = !existingKeys.has(key);
          if (isUnique) {
            existingKeys.add(key);
            uniques.push(unique);
          }
        }
        for (const interval of ["hour", "day"] as const) {
          addRollup(rollupMap, {
            ...currentScope,
            interval,
            bucket: new Date(intervalBucket(occurredAt, interval)),
            dimension,
            dimensionValue,
            humanClicks: event.botClassification === "human" ? 1 : 0,
            uniqueHumanClicks: isUnique ? 1 : 0,
            suspectedBotClicks: event.botClassification === "suspected-bot" ? 1 : 0,
          });
        }
      }
    }
  }
  return { uniques, rollups: [...rollupMap.values()] };
}

function scope(event: ClickEvent, kind: ScopeKind) {
  return kind === "link"
    ? {
        scopeKind: kind,
        scopeId: event.linkId,
        linkId: event.linkId,
        destinationVersionId: null,
      }
    : {
        scopeKind: kind,
        scopeId: event.destinationVersionId,
        linkId: event.linkId,
        destinationVersionId: event.destinationVersionId,
      };
}

function addRollup(rows: Map<string, RollupInsert>, value: RollupInsert) {
  const key = [
    value.scopeKind,
    value.scopeId,
    value.interval,
    value.bucket.getTime(),
    value.dimension,
    value.dimensionValue,
  ].join("\u0000");
  const current = rows.get(key);
  rows.set(
    key,
    current === undefined
      ? value
      : {
          ...current,
          humanClicks: (current.humanClicks ?? 0) + (value.humanClicks ?? 0),
          uniqueHumanClicks: (current.uniqueHumanClicks ?? 0) + (value.uniqueHumanClicks ?? 0),
          suspectedBotClicks: (current.suspectedBotClicks ?? 0) + (value.suspectedBotClicks ?? 0),
        },
  );
}

export function storedEvent(row: typeof databaseSchema.analyticsEvents.$inferSelect): ClickEvent {
  return {
    schemaVersion: 1,
    classificationVersion: 1,
    eventId: row.id,
    linkId: row.linkId,
    destinationVersionId: row.destinationVersionId,
    occurredAt: row.occurredAt.toISOString(),
    pseudonymousVisitor: row.pseudonymousVisitor,
    botClassification: row.botClassification,
    referrerDomain: row.referrerDomain,
    country: row.country,
    deviceCategory: row.deviceCategory,
  };
}

export function uniqueKey(value: UniqueInsert) {
  return [
    value.scopeKind,
    value.scopeId,
    value.halfHour.getTime(),
    value.dimension,
    value.dimensionValue,
    value.pseudonymousVisitor,
  ].join("\u0000");
}

export function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
