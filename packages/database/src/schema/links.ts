import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { idCheck, timestampCheck } from "./constraints";

export const links = sqliteTable(
  "links",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    searchTitle: text("search_title").notNull(),
    state: text("state", {
      enum: ["active", "disabled", "archived"],
    }).notNull(),
    revision: integer("revision").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("links_id_check", idCheck(table.id)),
    check("links_title_check", sql`length(${table.title}) BETWEEN 1 AND 200`),
    check("links_search_title_check", sql`length(${table.searchTitle}) BETWEEN 1 AND 2048`),
    check("links_state_check", sql`${table.state} IN ('active', 'disabled', 'archived')`),
    check(
      "links_revision_check",
      sql`typeof(${table.revision}) = 'integer' AND ${table.revision} >= 0`,
    ),
    check("links_created_at_check", timestampCheck(table.createdAt)),
    check("links_updated_at_check", timestampCheck(table.updatedAt)),
    check("links_timestamp_order_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    index("links_list_order_idx").on(sql`${table.createdAt} DESC`, sql`${table.id} ASC`),
    index("links_search_title_idx").on(table.searchTitle),
  ],
);

export const aliases = sqliteTable(
  "aliases",
  {
    alias: text("alias").primaryKey(),
    searchAlias: text("search_alias").notNull(),
    linkId: text("link_id").references(() => links.id, {
      onDelete: "restrict",
    }),
    deletedLinkId: text("deleted_link_id"),
    reservedAt: integer("reserved_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    check(
      "aliases_value_check",
      sql`length(${table.alias}) BETWEEN 1 AND 64
          AND ${table.alias} NOT GLOB '*[^A-Za-z0-9_-]*'`,
    ),
    check(
      "aliases_shape_check",
      sql`(
        ${table.linkId} IS NOT NULL
        AND ${table.deletedLinkId} IS NULL
        AND ${table.reservedAt} IS NULL
      ) OR (
        ${table.linkId} IS NULL
        AND ${table.deletedLinkId} IS NOT NULL
        AND ${table.reservedAt} IS NOT NULL
      )`,
    ),
    check("aliases_search_value_check", sql`length(${table.searchAlias}) BETWEEN 1 AND 64`),
    check(
      "aliases_deleted_link_id_check",
      sql`${table.deletedLinkId} IS NULL
          OR length(${table.deletedLinkId}) BETWEEN 1 AND 128`,
    ),
    check(
      "aliases_reserved_at_check",
      sql`${table.reservedAt} IS NULL
          OR (
            typeof(${table.reservedAt}) = 'integer'
            AND ${table.reservedAt} >= 0
          )`,
    ),
    uniqueIndex("aliases_link_id_unique").on(table.linkId),
    index("aliases_search_alias_idx").on(table.searchAlias),
    index("aliases_reserved_order_idx").on(sql`${table.reservedAt} DESC`, sql`${table.alias} ASC`),
  ],
);

export const destinationVersions = sqliteTable(
  "destination_versions",
  {
    id: text("id").primaryKey(),
    linkId: text("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    destination: text("destination").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("destination_versions_id_check", idCheck(table.id)),
    check(
      "destination_versions_number_check",
      sql`typeof(${table.versionNumber}) = 'integer'
          AND ${table.versionNumber} > 0`,
    ),
    check(
      "destination_versions_destination_check",
      sql`length(${table.destination}) BETWEEN 1 AND 8192`,
    ),
    check("destination_versions_created_at_check", timestampCheck(table.createdAt)),
    uniqueIndex("destination_versions_link_number_unique").on(table.linkId, table.versionNumber),
    index("destination_versions_latest_idx").on(table.linkId, table.versionNumber),
  ],
);
