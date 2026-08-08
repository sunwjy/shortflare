import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { destinationVersions, links } from "./links";
import { idCheck, timestampCheck } from "./constraints";

export const analyticsEvents = sqliteTable(
  "analytics_events",
  {
    id: text("id").primaryKey(),
    schemaVersion: integer("schema_version").notNull(),
    classificationVersion: integer("classification_version").notNull(),
    linkId: text("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    destinationVersionId: text("destination_version_id")
      .notNull()
      .references(() => destinationVersions.id, { onDelete: "cascade" }),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    ingestedAt: integer("ingested_at", { mode: "timestamp_ms" }).notNull(),
    pseudonymousVisitor: text("pseudonymous_visitor").notNull(),
    botClassification: text("bot_classification", {
      enum: ["human", "suspected-bot"],
    }).notNull(),
    referrerDomain: text("referrer_domain").notNull(),
    country: text("country").notNull(),
    deviceCategory: text("device_category", {
      enum: ["desktop", "mobile", "tablet", "other", "unknown"],
    }).notNull(),
  },
  (table) => [
    check("analytics_events_id_check", idCheck(table.id)),
    check("analytics_events_schema_version_check", sql`${table.schemaVersion} = 1`),
    check("analytics_events_classification_version_check", sql`${table.classificationVersion} = 1`),
    check("analytics_events_occurred_at_check", timestampCheck(table.occurredAt)),
    check("analytics_events_ingested_at_check", timestampCheck(table.ingestedAt)),
    check("analytics_events_pseudonym_check", sql`length(${table.pseudonymousVisitor}) = 43`),
    check(
      "analytics_events_bot_check",
      sql`${table.botClassification} IN ('human', 'suspected-bot')`,
    ),
    check(
      "analytics_events_referrer_check",
      sql`length(${table.referrerDomain}) BETWEEN 1 AND 253`,
    ),
    check(
      "analytics_events_country_check",
      sql`${table.country} = 'unknown' OR length(${table.country}) = 2`,
    ),
    check(
      "analytics_events_device_check",
      sql`${table.deviceCategory} IN ('desktop', 'mobile', 'tablet', 'other', 'unknown')`,
    ),
    index("analytics_events_link_time_idx").on(table.linkId, table.occurredAt),
    index("analytics_events_destination_time_idx").on(table.destinationVersionId, table.occurredAt),
    index("analytics_events_retention_idx").on(table.occurredAt),
  ],
);

export const analyticsUniques = sqliteTable(
  "analytics_uniques",
  {
    scopeKind: text("scope_kind", { enum: ["link", "destination-version"] }).notNull(),
    scopeId: text("scope_id").notNull(),
    linkId: text("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    destinationVersionId: text("destination_version_id").references(() => destinationVersions.id, {
      onDelete: "cascade",
    }),
    halfHour: integer("half_hour", { mode: "timestamp_ms" }).notNull(),
    dimension: text("dimension", {
      enum: ["total", "referrer", "country", "device"],
    }).notNull(),
    dimensionValue: text("dimension_value").notNull(),
    pseudonymousVisitor: text("pseudonymous_visitor").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.scopeKind,
        table.scopeId,
        table.halfHour,
        table.dimension,
        table.dimensionValue,
        table.pseudonymousVisitor,
      ],
    }),
    check(
      "analytics_uniques_scope_check",
      sql`(${table.scopeKind} = 'link' AND ${table.destinationVersionId} IS NULL)
          OR (${table.scopeKind} = 'destination-version' AND ${table.destinationVersionId} IS NOT NULL)`,
    ),
    check("analytics_uniques_scope_id_check", idCheck(table.scopeId)),
    check("analytics_uniques_half_hour_check", timestampCheck(table.halfHour)),
    check(
      "analytics_uniques_dimension_check",
      sql`${table.dimension} IN ('total', 'referrer', 'country', 'device')`,
    ),
    check(
      "analytics_uniques_dimension_value_check",
      sql`length(${table.dimensionValue}) BETWEEN 1 AND 253`,
    ),
    check("analytics_uniques_pseudonym_check", sql`length(${table.pseudonymousVisitor}) = 43`),
    index("analytics_uniques_retention_idx").on(table.halfHour),
    index("analytics_uniques_link_idx").on(table.linkId),
  ],
);

export const analyticsRollups = sqliteTable(
  "analytics_rollups",
  {
    scopeKind: text("scope_kind", { enum: ["link", "destination-version"] }).notNull(),
    scopeId: text("scope_id").notNull(),
    linkId: text("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    destinationVersionId: text("destination_version_id").references(() => destinationVersions.id, {
      onDelete: "cascade",
    }),
    interval: text("interval", { enum: ["hour", "day"] }).notNull(),
    bucket: integer("bucket", { mode: "timestamp_ms" }).notNull(),
    dimension: text("dimension", {
      enum: ["total", "referrer", "country", "device", "bot"],
    }).notNull(),
    dimensionValue: text("dimension_value").notNull(),
    humanClicks: integer("human_clicks").notNull().default(0),
    uniqueHumanClicks: integer("unique_human_clicks").notNull().default(0),
    suspectedBotClicks: integer("suspected_bot_clicks").notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [
        table.scopeKind,
        table.scopeId,
        table.interval,
        table.bucket,
        table.dimension,
        table.dimensionValue,
      ],
    }),
    check(
      "analytics_rollups_scope_check",
      sql`(${table.scopeKind} = 'link' AND ${table.destinationVersionId} IS NULL)
          OR (${table.scopeKind} = 'destination-version' AND ${table.destinationVersionId} IS NOT NULL)`,
    ),
    check("analytics_rollups_scope_id_check", idCheck(table.scopeId)),
    check("analytics_rollups_bucket_check", timestampCheck(table.bucket)),
    check(
      "analytics_rollups_dimension_check",
      sql`${table.dimension} IN ('total', 'referrer', 'country', 'device', 'bot')`,
    ),
    check(
      "analytics_rollups_dimension_value_check",
      sql`length(${table.dimensionValue}) BETWEEN 1 AND 253`,
    ),
    check(
      "analytics_rollups_counts_check",
      sql`${table.humanClicks} >= 0
          AND ${table.uniqueHumanClicks} >= 0
          AND ${table.suspectedBotClicks} >= 0`,
    ),
    index("analytics_rollups_query_idx").on(
      table.scopeKind,
      table.scopeId,
      table.interval,
      table.bucket,
    ),
    index("analytics_rollups_retention_idx").on(table.interval, table.bucket),
    index("analytics_rollups_link_idx").on(table.linkId),
  ],
);
