import {
  encodeDestinationVersionCursor,
  encodeListCursor,
  encodeReservedAliasCursor,
  type DestinationVersionPage,
  type LinkPage,
  type LinkSummary,
  type ReservedAliasPage,
} from "@shortflare/links";
import type {
  PersistenceDestinationVersionQuery,
  PersistenceListQuery,
  PersistenceReservedAliasQuery,
} from "@shortflare/links/persistence";
import { and, asc, desc, eq, inArray, isNull, lt, max, or, sql } from "drizzle-orm";
import { alias as tableAlias } from "drizzle-orm/sqlite-core";

import { databaseSchema, type ShortflareDatabase } from "../d1";
import { assertAlias, hydrateDestinationVersion, hydrateSummary } from "./d1-links-records";

export async function listLinks(
  database: ShortflareDatabase,
  query: PersistenceListQuery,
): Promise<LinkPage> {
  if (query.states.length === 0) {
    return { items: [], nextCursor: null };
  }

  const latest = tableAlias(databaseSchema.destinationVersions, "latest");
  const latestVersionNumber = database
    .select({ value: max(latest.versionNumber) })
    .from(latest)
    .where(eq(latest.linkId, databaseSchema.links.id));
  // The seek predicate must mirror the immutable ORDER BY exactly; using
  // updatedAt or reversing the ID tie-breaker would skip or duplicate rows.
  const seek =
    query.cursor === undefined
      ? undefined
      : or(
          lt(databaseSchema.links.createdAt, query.cursor.createdAt),
          and(
            eq(databaseSchema.links.createdAt, query.cursor.createdAt),
            sql`${databaseSchema.links.id} > ${query.cursor.id}`,
          ),
        );
  const rows = await database
    .select({
      id: databaseSchema.links.id,
      alias: databaseSchema.aliases.alias,
      title: databaseSchema.links.title,
      state: databaseSchema.links.state,
      revision: databaseSchema.links.revision,
      createdAt: databaseSchema.links.createdAt,
      updatedAt: databaseSchema.links.updatedAt,
      destinationVersionId: databaseSchema.destinationVersions.id,
      destination: databaseSchema.destinationVersions.destination,
      versionNumber: databaseSchema.destinationVersions.versionNumber,
      destinationCreatedAt: databaseSchema.destinationVersions.createdAt,
    })
    .from(databaseSchema.links)
    .innerJoin(databaseSchema.aliases, eq(databaseSchema.aliases.linkId, databaseSchema.links.id))
    .innerJoin(
      databaseSchema.destinationVersions,
      and(
        eq(databaseSchema.destinationVersions.linkId, databaseSchema.links.id),
        sql`${databaseSchema.destinationVersions.versionNumber} = (${latestVersionNumber})`,
      ),
    )
    .where(
      and(
        inArray(databaseSchema.links.state, [...query.states]),
        query.search === ""
          ? undefined
          : or(
              sql`instr(${databaseSchema.aliases.searchAlias}, ${query.search}) > 0`,
              sql`instr(${databaseSchema.links.searchTitle}, ${query.search}) > 0`,
            ),
        seek,
      ),
    )
    .orderBy(desc(databaseSchema.links.createdAt), asc(databaseSchema.links.id))
    .limit(query.limit + 1);
  const pageRows = rows.slice(0, query.limit);
  const items = pageRows.map(hydrateSummary);
  const lastItem = items.at(-1);

  return {
    items,
    nextCursor:
      rows.length > query.limit && lastItem !== undefined
        ? encodeListCursor(query.search, query.states, {
            createdAt: lastItem.createdAt,
            id: lastItem.id,
          })
        : null,
  };
}

export async function findLinkSummariesByIds(
  database: ShortflareDatabase,
  ids: readonly string[],
): Promise<readonly LinkSummary[]> {
  if (ids.length === 0) return [];

  const latest = tableAlias(databaseSchema.destinationVersions, "latest");
  const latestVersionNumber = database
    .select({ value: max(latest.versionNumber) })
    .from(latest)
    .where(eq(latest.linkId, databaseSchema.links.id));
  const rows = await database
    .select({
      id: databaseSchema.links.id,
      alias: databaseSchema.aliases.alias,
      title: databaseSchema.links.title,
      state: databaseSchema.links.state,
      revision: databaseSchema.links.revision,
      createdAt: databaseSchema.links.createdAt,
      updatedAt: databaseSchema.links.updatedAt,
      destinationVersionId: databaseSchema.destinationVersions.id,
      destination: databaseSchema.destinationVersions.destination,
      versionNumber: databaseSchema.destinationVersions.versionNumber,
      destinationCreatedAt: databaseSchema.destinationVersions.createdAt,
    })
    .from(databaseSchema.links)
    .innerJoin(databaseSchema.aliases, eq(databaseSchema.aliases.linkId, databaseSchema.links.id))
    .innerJoin(
      databaseSchema.destinationVersions,
      and(
        eq(databaseSchema.destinationVersions.linkId, databaseSchema.links.id),
        sql`${databaseSchema.destinationVersions.versionNumber} = (${latestVersionNumber})`,
      ),
    )
    .where(inArray(databaseSchema.links.id, [...new Set(ids)]));
  const summaries = new Map(rows.map((row) => [row.id, hydrateSummary(row)]));
  return ids.flatMap((id) => {
    const summary = summaries.get(id);
    return summary === undefined ? [] : [summary];
  });
}

export async function listDestinationVersions(
  database: ShortflareDatabase,
  linkId: string,
  query: PersistenceDestinationVersionQuery,
): Promise<DestinationVersionPage | null> {
  const existing = await database
    .select({ currentVersionNumber: max(databaseSchema.destinationVersions.versionNumber) })
    .from(databaseSchema.links)
    .innerJoin(
      databaseSchema.destinationVersions,
      eq(databaseSchema.destinationVersions.linkId, databaseSchema.links.id),
    )
    .where(eq(databaseSchema.links.id, linkId))
    .groupBy(databaseSchema.links.id)
    .limit(1);
  const currentVersionNumber = existing[0]?.currentVersionNumber;
  if (currentVersionNumber === undefined || currentVersionNumber === null) return null;

  const rows = await database
    .select({
      id: databaseSchema.destinationVersions.id,
      destination: databaseSchema.destinationVersions.destination,
      versionNumber: databaseSchema.destinationVersions.versionNumber,
      createdAt: databaseSchema.destinationVersions.createdAt,
    })
    .from(databaseSchema.destinationVersions)
    .where(
      and(
        eq(databaseSchema.destinationVersions.linkId, linkId),
        query.cursor === undefined
          ? undefined
          : lt(databaseSchema.destinationVersions.versionNumber, query.cursor.versionNumber),
      ),
    )
    .orderBy(desc(databaseSchema.destinationVersions.versionNumber))
    .limit(query.limit + 1);
  const items = rows.slice(0, query.limit).map(hydrateDestinationVersion);
  const lastItem = items.at(-1);
  return {
    items,
    currentVersionNumber,
    nextCursor:
      rows.length > query.limit && lastItem !== undefined
        ? encodeDestinationVersionCursor(linkId, lastItem.versionNumber)
        : null,
  };
}

export async function listReservedAliases(
  database: ShortflareDatabase,
  query: PersistenceReservedAliasQuery,
): Promise<ReservedAliasPage> {
  const seek =
    query.cursor === undefined
      ? undefined
      : or(
          lt(databaseSchema.aliases.reservedAt, query.cursor.reservedAt),
          and(
            eq(databaseSchema.aliases.reservedAt, query.cursor.reservedAt),
            sql`${databaseSchema.aliases.alias} > ${query.cursor.alias} COLLATE BINARY`,
          ),
        );
  const rows = await database
    .select({
      alias: databaseSchema.aliases.alias,
      deletedLinkId: databaseSchema.aliases.deletedLinkId,
      reservedAt: databaseSchema.aliases.reservedAt,
    })
    .from(databaseSchema.aliases)
    .where(
      and(
        isNull(databaseSchema.aliases.linkId),
        sql`instr(${databaseSchema.aliases.searchAlias}, ${query.search}) > 0`,
        seek,
      ),
    )
    .orderBy(
      desc(databaseSchema.aliases.reservedAt),
      asc(sql`${databaseSchema.aliases.alias} COLLATE BINARY`),
    )
    .limit(query.limit + 1);
  const items = rows.slice(0, query.limit).map((row) => {
    if (row.deletedLinkId === null || row.reservedAt === null) {
      throw new Error(`Reserved Alias ${row.alias} is incomplete`);
    }
    return {
      alias: assertAlias(row.alias),
      deletedLinkId: row.deletedLinkId,
      reservedAt: row.reservedAt,
    };
  });
  const lastItem = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > query.limit && lastItem !== undefined
        ? encodeReservedAliasCursor(query.search, {
            reservedAt: lastItem.reservedAt,
            alias: lastItem.alias,
          })
        : null,
  };
}
