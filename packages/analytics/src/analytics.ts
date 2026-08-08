import {
  CLICK_EVENT_CLASSIFICATION_VERSION,
  CLICK_EVENT_SCHEMA_VERSION,
  type BotClassification,
  type ClickEvent,
  type DeviceCategory,
  isAnalyticsCountry,
  isAnalyticsReferrerDomain,
} from "./click-analytics";
import type { AnalyticsPersistence } from "./persistence";
import { DAY_MS, HOUR_MS, intervalBucket, RAW_RETENTION_MS } from "./event-policy";

export type IngestionResult =
  | Readonly<{ kind: "ingested" | "duplicate"; eventId: string }>
  | Readonly<{
      kind: "rejected";
      eventId: string | null;
      reason: "invalid-event" | "unsupported-schema" | "integrity-conflict";
    }>;

export type AnalyticsScope =
  | Readonly<{ kind: "instance" }>
  | Readonly<{ kind: "link"; linkId: string }>
  | Readonly<{
      kind: "destination-version";
      linkId: string;
      destinationVersionId: string;
    }>;

export type AnalyticsQuery = Readonly<{
  scope: AnalyticsScope;
  granularity: "hour" | "day";
  start: Date;
  end: Date;
  limit?: number;
}>;

export type AnalyticsSummary = Readonly<{
  humanClicks: number;
  uniqueHumanClicks: number;
  suspectedBotClicks: number;
}>;

export type AnalyticsSeriesPoint = AnalyticsSummary & Readonly<{ bucket: string }>;
export type AnalyticsBreakdownItem = AnalyticsSummary & Readonly<{ value: string }>;
export type AnalyticsBreakdown = Readonly<{
  items: readonly AnalyticsBreakdownItem[];
  truncated: boolean;
}>;

export type AnalyticsQueryResult =
  | Readonly<{
      kind: "ok";
      summary: AnalyticsSummary;
      series: readonly AnalyticsSeriesPoint[];
      breakdowns: Readonly<{
        referrer: AnalyticsBreakdown;
        country: AnalyticsBreakdown;
        device: AnalyticsBreakdown;
        bot: AnalyticsBreakdown;
      }>;
      topLinks: AnalyticsBreakdown;
    }>
  | Readonly<{ kind: "invalid-query" }>
  | Readonly<{ kind: "not-found" }>;

export type AnalyticsCommand =
  | Readonly<{ kind: "expire" }>
  | Readonly<{
      kind: "erase";
      scope: Readonly<{ kind: "instance" }> | Readonly<{ kind: "link"; linkId: string }>;
      actor: Readonly<{ id: string }>;
    }>
  | Readonly<{
      kind: "recalculate";
      linkId: string;
      date: Date;
      actor: Readonly<{ id: string }>;
    }>;

export type AnalyticsCommandResult =
  | Readonly<{
      kind: "completed";
      affectedEvents: number;
      auditId?: string;
    }>
  | Readonly<{ kind: "invalid-command" }>
  | Readonly<{ kind: "incomplete-raw" }>;

export type Analytics = Readonly<{
  ingest(events: readonly unknown[]): Promise<readonly IngestionResult[]>;
  query(query: AnalyticsQuery): Promise<AnalyticsQueryResult>;
  execute(command: AnalyticsCommand): Promise<AnalyticsCommandResult>;
}>;

type AnalyticsDependencies = Readonly<{
  persistence: AnalyticsPersistence;
  now?: () => Date;
  randomId?: () => string;
}>;

type ParsedEvent =
  | Readonly<{ kind: "valid"; event: ClickEvent }>
  | Readonly<{
      kind: "rejected";
      eventId: string | null;
      reason: "invalid-event" | "unsupported-schema";
    }>;

export function createAnalytics(dependencies: AnalyticsDependencies): Analytics {
  const now = dependencies.now ?? (() => new Date());
  const randomId = dependencies.randomId ?? (() => crypto.randomUUID());
  return {
    async ingest(inputs) {
      const parsed = inputs.map(parseEvent);
      const validEvents = parsed.flatMap((result) =>
        result.kind === "valid" ? [result.event] : [],
      );
      const persisted = await dependencies.persistence.ingest(validEvents, now());
      let persistedIndex = 0;
      return parsed.map((result): IngestionResult => {
        if (result.kind === "rejected") {
          return result;
        }
        const persistedResult = persisted[persistedIndex];
        persistedIndex += 1;
        if (persistedResult === undefined) {
          throw new Error("Analytics persistence returned an incomplete ingestion result");
        }
        return persistedResult.kind === "integrity-conflict"
          ? {
              kind: "rejected",
              eventId: persistedResult.eventId,
              reason: "integrity-conflict",
            }
          : persistedResult.kind === "invalid-reference"
            ? {
                kind: "rejected",
                eventId: persistedResult.eventId,
                reason: "invalid-event",
              }
            : persistedResult;
      });
    },
    async query(query) {
      if (!isValidQuery(query, now())) {
        return { kind: "invalid-query" };
      }
      return dependencies.persistence.query({ ...query, limit: query.limit ?? 10 });
    },
    async execute(command) {
      if (!isValidCommand(command)) {
        return { kind: "invalid-command" };
      }
      if (command.kind === "expire") {
        const retentionBoundary = new Date(now().getTime() - RAW_RETENTION_MS);
        return dependencies.persistence.execute({
          kind: "expire",
          rawBefore: retentionBoundary,
          hourlyBefore: new Date(intervalBucket(retentionBoundary, "hour")),
        });
      }
      return dependencies.persistence.execute({
        ...command,
        auditId: randomId(),
        occurredAt: now(),
      });
    },
  };
}

function parseEvent(value: unknown): ParsedEvent {
  if (!isRecord(value)) {
    return { kind: "rejected", eventId: null, reason: "invalid-event" };
  }
  const eventId = typeof value.eventId === "string" ? value.eventId : null;
  if (value.schemaVersion !== CLICK_EVENT_SCHEMA_VERSION) {
    return {
      kind: "rejected",
      eventId,
      reason: "unsupported-schema",
    };
  }
  if (
    value.classificationVersion !== CLICK_EVENT_CLASSIFICATION_VERSION ||
    eventId === null ||
    !isId(value.eventId) ||
    !isId(value.linkId) ||
    !isId(value.destinationVersionId) ||
    !isIsoDate(value.occurredAt) ||
    !isPseudonym(value.pseudonymousVisitor) ||
    !isBotClassification(value.botClassification) ||
    typeof value.referrerDomain !== "string" ||
    !isAnalyticsReferrerDomain(value.referrerDomain) ||
    typeof value.country !== "string" ||
    !isAnalyticsCountry(value.country) ||
    !isDeviceCategory(value.deviceCategory)
  ) {
    return { kind: "rejected", eventId, reason: "invalid-event" };
  }
  return {
    kind: "valid",
    event: {
      schemaVersion: CLICK_EVENT_SCHEMA_VERSION,
      classificationVersion: CLICK_EVENT_CLASSIFICATION_VERSION,
      eventId,
      linkId: value.linkId,
      destinationVersionId: value.destinationVersionId,
      occurredAt: value.occurredAt,
      pseudonymousVisitor: value.pseudonymousVisitor,
      botClassification: value.botClassification,
      referrerDomain: value.referrerDomain,
      country: value.country,
      deviceCategory: value.deviceCategory,
    },
  };
}

function isValidQuery(query: AnalyticsQuery, now: Date): boolean {
  const limit = query.limit ?? 10;
  const bucketSize = query.granularity === "hour" ? HOUR_MS : DAY_MS;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    !Number.isFinite(query.start.getTime()) ||
    !Number.isFinite(query.end.getTime()) ||
    query.start.getTime() >= query.end.getTime() ||
    query.start.getTime() % bucketSize !== 0 ||
    query.end.getTime() % bucketSize !== 0
  ) {
    return false;
  }
  return query.granularity !== "hour" || query.start.getTime() >= now.getTime() - RAW_RETENTION_MS;
}

function isValidCommand(command: AnalyticsCommand): boolean {
  if (command.kind === "expire") {
    return true;
  }
  if (command.actor.id.length === 0) {
    return false;
  }
  if (command.kind === "erase") {
    return command.scope.kind === "instance" || command.scope.linkId.length > 0;
  }
  return (
    command.linkId.length > 0 &&
    Number.isFinite(command.date.getTime()) &&
    command.date.getTime() % DAY_MS === 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isId(value: unknown): value is string {
  return isBoundedString(value, 128);
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isPseudonym(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const parsed = new Date(value);
  return (
    Number.isFinite(parsed.getTime()) && parsed.getTime() >= 0 && parsed.toISOString() === value
  );
}

function isBotClassification(value: unknown): value is BotClassification {
  return value === "human" || value === "suspected-bot";
}

function isDeviceCategory(value: unknown): value is DeviceCategory {
  return (
    value === "desktop" ||
    value === "mobile" ||
    value === "tablet" ||
    value === "other" ||
    value === "unknown"
  );
}
