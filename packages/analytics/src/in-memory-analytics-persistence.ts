import type { AnalyticsScope } from "./analytics";
import type { ClickEvent } from "./click-analytics";
import { DAY_MS, sameClickEvent } from "./event-policy";
import { buildInMemoryResult } from "./in-memory-analytics-results";
import {
  mergeRetainedRollups,
  retainDailyRollups,
  type RetainedDailyRollup,
} from "./in-memory-analytics-retention";
import type {
  AnalyticsPersistence,
  PersistedIngestionResult,
  PersistenceCommand,
} from "./persistence";

type StoredEvent = Readonly<{ event: ClickEvent; ingestedAt: Date }>;

export function createInMemoryAnalyticsPersistence(): AnalyticsPersistence {
  const events = new Map<string, StoredEvent>();
  const retainedDailyRollups = new Map<string, RetainedDailyRollup>();
  const knownLinks = new Set<string>();
  const knownDestinations = new Set<string>();
  return {
    async ingest(inputs, ingestedAt) {
      const results: PersistedIngestionResult[] = [];
      for (const event of inputs) {
        const existing = events.get(event.eventId);
        if (existing !== undefined) {
          results.push({
            kind: sameClickEvent(existing.event, event) ? "duplicate" : "integrity-conflict",
            eventId: event.eventId,
          });
          continue;
        }
        events.set(event.eventId, { event, ingestedAt });
        knownLinks.add(event.linkId);
        knownDestinations.add(`${event.linkId}\u0000${event.destinationVersionId}`);
        results.push({ kind: "ingested", eventId: event.eventId });
      }
      return results;
    },
    async query(query) {
      const allEvents = [...events.values()].map(({ event }) => event);
      if (!scopeExists(knownLinks, knownDestinations, query.scope)) {
        return { kind: "not-found" };
      }
      const live = buildInMemoryResult(allEvents, query);
      return query.granularity === "day"
        ? mergeRetainedRollups(live, retainedDailyRollups.values(), query)
        : live;
    },
    async execute(command) {
      if (command.kind === "expire") {
        const expired: StoredEvent[] = [];
        for (const [eventId, stored] of events) {
          if (new Date(stored.event.occurredAt) < command.rawBefore) {
            events.delete(eventId);
            expired.push(stored);
          }
        }
        retainDailyRollups(
          retainedDailyRollups,
          expired.map(({ event }) => event),
        );
        return { kind: "completed", affectedEvents: expired.length };
      }
      if (command.kind === "erase") {
        const erased = erase(events, retainedDailyRollups, command);
        return !erased.changed
          ? { kind: "completed", affectedEvents: erased.affectedEvents }
          : {
              kind: "completed",
              affectedEvents: erased.affectedEvents,
              auditId: command.auditId,
            };
      }
      const start = command.date.getTime();
      const end = start + DAY_MS;
      const incomplete = [...retainedDailyRollups.values()].some(
        (rollup) =>
          rollup.day === start &&
          rollup.scope.kind === "link" &&
          rollup.scope.linkId === command.linkId,
      );
      if (incomplete) {
        return { kind: "incomplete-raw" };
      }
      const affectedEvents = [...events.values()].filter(({ event }) => {
        const occurredAt = new Date(event.occurredAt).getTime();
        return event.linkId === command.linkId && occurredAt >= start && occurredAt < end;
      }).length;
      return affectedEvents === 0
        ? { kind: "completed", affectedEvents }
        : { kind: "completed", affectedEvents, auditId: command.auditId };
    },
  };
}

function erase(
  events: Map<string, StoredEvent>,
  retainedDailyRollups: Map<string, RetainedDailyRollup>,
  command: Extract<PersistenceCommand, { kind: "erase" }>,
): Readonly<{ affectedEvents: number; changed: boolean }> {
  let affectedEvents = 0;
  let changed = false;
  for (const [eventId, stored] of events) {
    if (command.scope.kind === "instance" || stored.event.linkId === command.scope.linkId) {
      events.delete(eventId);
      affectedEvents += 1;
      changed = true;
    }
  }
  for (const [key, rollup] of retainedDailyRollups) {
    if (command.scope.kind === "instance" || rollup.linkId === command.scope.linkId) {
      retainedDailyRollups.delete(key);
      changed = true;
    }
  }
  return { affectedEvents, changed };
}

function scopeExists(
  knownLinks: ReadonlySet<string>,
  knownDestinations: ReadonlySet<string>,
  scope: AnalyticsScope,
): boolean {
  if (scope.kind === "instance") {
    return true;
  }
  return scope.kind === "link"
    ? knownLinks.has(scope.linkId)
    : knownDestinations.has(`${scope.linkId}\u0000${scope.destinationVersionId}`);
}
