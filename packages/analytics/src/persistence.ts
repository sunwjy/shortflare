import type { AnalyticsCommandResult, AnalyticsQuery, AnalyticsQueryResult } from "./analytics";
import type { ClickEvent } from "./click-analytics";

export type PersistedIngestionResult =
  | Readonly<{ kind: "ingested" | "duplicate"; eventId: string }>
  | Readonly<{ kind: "integrity-conflict"; eventId: string }>
  | Readonly<{ kind: "invalid-reference"; eventId: string }>;

export type ValidatedAnalyticsQuery = AnalyticsQuery & Readonly<{ limit: number }>;

export type PersistenceCommand =
  | Readonly<{ kind: "expire"; rawBefore: Date; hourlyBefore: Date }>
  | Readonly<{
      kind: "erase";
      scope: Readonly<{ kind: "instance" }> | Readonly<{ kind: "link"; linkId: string }>;
      actor: Readonly<{ id: string }>;
      auditId: string;
      occurredAt: Date;
    }>
  | Readonly<{
      kind: "recalculate";
      linkId: string;
      date: Date;
      actor: Readonly<{ id: string }>;
      auditId: string;
      occurredAt: Date;
    }>;

export type AnalyticsPersistence = Readonly<{
  ingest(
    events: readonly ClickEvent[],
    ingestedAt: Date,
  ): Promise<readonly PersistedIngestionResult[]>;
  query(query: ValidatedAnalyticsQuery): Promise<AnalyticsQueryResult>;
  execute(command: PersistenceCommand): Promise<AnalyticsCommandResult>;
}>;
