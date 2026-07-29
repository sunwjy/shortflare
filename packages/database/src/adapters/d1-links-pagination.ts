import {
  encodeDestinationVersionCursor,
  encodeListCursor,
  encodeReservedAliasCursor,
  type DestinationVersionPage,
  type LinkPage,
  type ReservedAliasPage,
} from "@shortflare/links";
import type {
  PersistenceDestinationVersionQuery,
  PersistenceListQuery,
  PersistenceReservedAliasQuery,
} from "@shortflare/links/persistence";

import {
  assertAlias,
  hydrateDestinationVersion,
  hydrateSummary,
  type DestinationVersionRow,
  type LinkSummarySqlRow,
} from "./d1-links-records";

export async function listLinks(
  database: D1Database,
  query: PersistenceListQuery,
): Promise<LinkPage> {
  if (query.states.length === 0) {
    return { items: [], nextCursor: null };
  }

  const statePlaceholders = query.states.map(() => "?").join(", ");
  const cursorSql =
    query.cursor === undefined
      ? ""
      : `AND (
           l.created_at < ?
           OR (l.created_at = ? AND l.id > ?)
         )`;
  const result = await database
    .prepare(
      `SELECT
         l.id,
         a.alias,
         l.title,
         l.state,
         l.revision,
         l.created_at AS createdAt,
         l.updated_at AS updatedAt,
         dv.id AS destinationVersionId,
         dv.destination,
         dv.version_number AS versionNumber,
         dv.created_at AS destinationCreatedAt
       FROM links l
       JOIN aliases a ON a.link_id = l.id
       JOIN destination_versions dv
         ON dv.link_id = l.id
        AND dv.version_number = (
          SELECT MAX(latest.version_number)
          FROM destination_versions latest
          WHERE latest.link_id = l.id
        )
       WHERE l.state IN (${statePlaceholders})
         AND (
           ? = ''
           OR instr(a.search_alias, ?) > 0
           OR instr(l.search_title, ?) > 0
         )
         ${cursorSql}
       ORDER BY l.created_at DESC, l.id ASC
       LIMIT ?`,
    )
    .bind(
      ...query.states,
      query.search,
      query.search,
      query.search,
      ...(query.cursor === undefined
        ? []
        : [query.cursor.createdAt.getTime(), query.cursor.createdAt.getTime(), query.cursor.id]),
      query.limit + 1,
    )
    .all<LinkSummarySqlRow>();
  const pageRows = result.results.slice(0, query.limit);
  const items = pageRows.map(hydrateSummary);
  const lastItem = items.at(-1);

  return {
    items,
    nextCursor:
      result.results.length > query.limit && lastItem !== undefined
        ? encodeListCursor(query.search, query.states, {
            createdAt: lastItem.createdAt,
            id: lastItem.id,
          })
        : null,
  };
}

export async function listDestinationVersions(
  database: D1Database,
  linkId: string,
  query: PersistenceDestinationVersionQuery,
): Promise<DestinationVersionPage | null> {
  const exists = await database
    .prepare(
      `SELECT MAX(dv.version_number) AS currentVersionNumber
       FROM links l
       JOIN destination_versions dv ON dv.link_id = l.id
       WHERE l.id = ?
       GROUP BY l.id`,
    )
    .bind(linkId)
    .first<{ currentVersionNumber: number }>();
  if (exists === null) return null;

  const result = await database
    .prepare(
      `SELECT
         id,
         destination,
         version_number AS versionNumber,
         created_at AS createdAt
       FROM destination_versions
       WHERE link_id = ?
         AND (? IS NULL OR version_number < ?)
       ORDER BY version_number DESC
       LIMIT ?`,
    )
    .bind(
      linkId,
      query.cursor?.versionNumber ?? null,
      query.cursor?.versionNumber ?? null,
      query.limit + 1,
    )
    .all<DestinationVersionRow>();
  const items = result.results.slice(0, query.limit).map(hydrateDestinationVersion);
  const lastItem = items.at(-1);
  return {
    items,
    currentVersionNumber: exists.currentVersionNumber,
    nextCursor:
      result.results.length > query.limit && lastItem !== undefined
        ? encodeDestinationVersionCursor(linkId, lastItem.versionNumber)
        : null,
  };
}

export async function listReservedAliases(
  database: D1Database,
  query: PersistenceReservedAliasQuery,
): Promise<ReservedAliasPage> {
  const result = await database
    .prepare(
      `SELECT
         alias,
         deleted_link_id AS deletedLinkId,
         reserved_at AS reservedAt
       FROM aliases
       WHERE link_id IS NULL
         AND instr(search_alias, ?) > 0
         AND (
           ? IS NULL
           OR reserved_at < ?
           OR (reserved_at = ? AND alias > ? COLLATE BINARY)
         )
       ORDER BY reserved_at DESC, alias COLLATE BINARY ASC
       LIMIT ?`,
    )
    .bind(
      query.search,
      query.cursor?.reservedAt.getTime() ?? null,
      query.cursor?.reservedAt.getTime() ?? null,
      query.cursor?.reservedAt.getTime() ?? null,
      query.cursor?.alias ?? null,
      query.limit + 1,
    )
    .all<{ alias: string; deletedLinkId: string; reservedAt: number }>();
  const items = result.results.slice(0, query.limit).map((row) => ({
    alias: assertAlias(row.alias),
    deletedLinkId: row.deletedLinkId,
    reservedAt: new Date(row.reservedAt),
  }));
  const lastItem = items.at(-1);
  return {
    items,
    nextCursor:
      result.results.length > query.limit && lastItem !== undefined
        ? encodeReservedAliasCursor(query.search, {
            reservedAt: lastItem.reservedAt,
            alias: lastItem.alias,
          })
        : null,
  };
}
