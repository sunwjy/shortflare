import type {
  Alias,
  DestinationVersion,
  Link,
  LinkMutationContext,
  LinkState,
  LinksPersistence,
  PersistedLinkMutation,
} from "@shortflare/links";
import {
  encodeDestinationVersionCursor,
  encodeListCursor,
  encodeReservedAliasCursor,
  foldCase,
  parseAlias,
} from "@shortflare/links";

// Optimistic-concurrency retries must observe the result of the prior attempt.
// oxlint-disable no-await-in-loop

type LinkRow = {
  id: string;
  alias: string;
  title: string;
  state: LinkState;
  revision: number;
  createdAt: number;
  updatedAt: number;
};

type DestinationVersionRow = {
  id: string;
  destination: string;
  versionNumber: number;
  createdAt: number;
};

type StoredLink = Readonly<{
  link: Link;
  revision: number;
  currentVersionNumber: number;
}>;

type PermanentlyDeleteResult = Awaited<ReturnType<LinksPersistence["permanentlyDelete"]>>;

const retryMutation = Symbol("retry-mutation");
const maximumMutationAttempts = 3;

export type CreateD1LinksPersistenceOptions = Readonly<{
  generateAuditId?: () => string;
}>;

export function createD1LinksPersistence(
  database: D1Database,
  options: CreateD1LinksPersistenceOptions = {},
): LinksPersistence {
  const generateAuditId = options.generateAuditId ?? (() => crypto.randomUUID());

  return {
    async create(link, context) {
      const existing = await findAlias(database, link.alias);
      if (existing !== null) {
        return existing.linkId === null ? "alias-reserved" : "alias-in-use";
      }

      const destinationVersion = link.destinationVersions[0];
      if (destinationVersion === undefined) {
        throw new Error("Cannot persist a Link without a Destination Version");
      }

      try {
        await database.batch([
          database
            .prepare(
              `INSERT INTO links
                 (id, title, search_title, state, revision, created_at, updated_at)
               VALUES (?, ?, ?, ?, 0, ?, ?)`,
            )
            .bind(
              link.id,
              link.title,
              foldCase(link.title),
              link.state,
              link.createdAt.getTime(),
              link.updatedAt.getTime(),
            ),
          database
            .prepare(
              `INSERT INTO aliases
                 (alias, search_alias, link_id, deleted_link_id, reserved_at)
               VALUES (?, ?, ?, NULL, NULL)`,
            )
            .bind(link.alias, foldCase(link.alias), link.id),
          database
            .prepare(
              `INSERT INTO destination_versions
                 (id, link_id, version_number, destination, created_at)
               VALUES (?, ?, 1, ?, ?)`,
            )
            .bind(
              destinationVersion.id,
              link.id,
              destinationVersion.destination,
              destinationVersion.createdAt.getTime(),
            ),
          insertAuditEvent(database, generateAuditId(), context, link.id, {
            alias: link.alias,
          }),
        ]);
        return "created";
      } catch (error) {
        const collided = await findAlias(database, link.alias);
        if (collided !== null) {
          return collided.linkId === null ? "alias-reserved" : "alias-in-use";
        }
        throw error;
      }
    },

    async findByAlias(alias) {
      return readStoredLink(database, "a.alias = ?", alias).then((stored) =>
        stored === null ? null : stored.link,
      );
    },

    async findById(id) {
      return readStoredLink(database, "l.id = ?", id).then((stored) =>
        stored === null ? null : stored.link,
      );
    },

    async findReservedAlias(alias) {
      const row = await database
        .prepare(
          `SELECT
             alias,
             deleted_link_id AS deletedLinkId,
             reserved_at AS reservedAt
           FROM aliases
           WHERE alias = ? AND link_id IS NULL`,
        )
        .bind(alias)
        .first<{
          alias: string;
          deletedLinkId: string;
          reservedAt: number;
        }>();
      if (row === null) return null;

      return {
        alias: assertAlias(row.alias),
        deletedLinkId: row.deletedLinkId,
        reservedAt: new Date(row.reservedAt),
      };
    },

    async transitionState(linkId, expectedRevision, target, allowedCurrentStates, context) {
      return retryStoredLinkMutation<PersistedLinkMutation>(
        database,
        linkId,
        "transition Link state",
        async (stored) => {
          if (stored.revision !== expectedRevision) {
            return { kind: "conflict", currentRevision: stored.revision };
          }
          if (!allowedCurrentStates.includes(stored.link.state)) {
            return { kind: "invalid-state", state: stored.link.state };
          }
          if (stored.link.state === target) {
            return unchanged(stored.link);
          }

          const results = await database.batch([
            database
              .prepare(
                `INSERT INTO audit_events
                 (id, actor_id, action, subject_id, occurred_at, metadata)
               SELECT ?, ?, ?, id, ?, ?
               FROM links
               WHERE id = ? AND revision = ? AND state = ?`,
              )
              .bind(
                generateAuditId(),
                context.actor.id,
                context.action,
                context.occurredAt.getTime(),
                JSON.stringify({
                  fromState: stored.link.state,
                  toState: target,
                }),
                linkId,
                stored.revision,
                stored.link.state,
              ),
            database
              .prepare(
                `UPDATE links
               SET state = ?, updated_at = ?, revision = revision + 1
               WHERE id = ? AND revision = ? AND state = ?`,
              )
              .bind(
                target,
                context.occurredAt.getTime(),
                linkId,
                stored.revision,
                stored.link.state,
              ),
            ...readLinkStatements(database, linkId),
          ]);
          if (changes(results[1]) === 1) {
            return updated(hydrateBatchLink(results, 2, 3));
          }
          return retryMutation;
        },
        () => ({ kind: "not-found" }),
      );
    },

    async edit(linkId, expectedRevision, values, context) {
      return retryStoredLinkMutation<PersistedLinkMutation>(
        database,
        linkId,
        "edit Link",
        async (stored) => {
          if (stored.revision !== expectedRevision) {
            return { kind: "conflict", currentRevision: stored.revision };
          }
          if (stored.link.state === "archived") {
            return { kind: "invalid-state", state: stored.link.state };
          }

          const currentDestination = stored.link.destinationVersions.at(-1);
          const title = values.title ?? stored.link.title;
          const titleChanged = title !== stored.link.title;
          const destinationChanged =
            values.destinationVersion !== undefined &&
            values.destinationVersion.destination !== currentDestination?.destination;
          if (!titleChanged && !destinationChanged) return unchanged(stored.link);

          const changedFields = [
            ...(titleChanged ? ["title"] : []),
            ...(destinationChanged ? ["destination"] : []),
          ];
          const metadata = {
            changedFields,
            ...(destinationChanged ? { destinationVersionId: values.destinationVersion!.id } : {}),
          };
          const statements: D1PreparedStatement[] = [
            database
              .prepare(
                `INSERT INTO audit_events
                   (id, actor_id, action, subject_id, occurred_at, metadata)
                 SELECT ?, ?, ?, id, ?, ?
                 FROM links
                 WHERE id = ? AND revision = ? AND state != 'archived'`,
              )
              .bind(
                generateAuditId(),
                context.actor.id,
                context.action,
                context.occurredAt.getTime(),
                JSON.stringify(metadata),
                linkId,
                stored.revision,
              ),
          ];
          if (destinationChanged) {
            statements.push(
              database
                .prepare(
                  `INSERT INTO destination_versions
                     (id, link_id, version_number, destination, created_at)
                   SELECT ?, id, ?, ?, ?
                   FROM links
                   WHERE id = ? AND revision = ? AND state != 'archived'`,
                )
                .bind(
                  values.destinationVersion!.id,
                  stored.currentVersionNumber + 1,
                  values.destinationVersion!.destination,
                  values.destinationVersion!.createdAt.getTime(),
                  linkId,
                  stored.revision,
                ),
            );
          }
          const updateIndex = statements.length;
          statements.push(
            database
              .prepare(
                `UPDATE links
                 SET title = ?, search_title = ?, updated_at = ?,
                     revision = revision + 1
                 WHERE id = ? AND revision = ? AND state != 'archived'`,
              )
              .bind(title, foldCase(title), context.occurredAt.getTime(), linkId, stored.revision),
            ...readLinkStatements(database, linkId),
          );
          const results = await database.batch(statements);
          if (changes(results[updateIndex]) === 1) {
            return updated(hydrateBatchLink(results, updateIndex + 1, updateIndex + 2));
          }
          return retryMutation;
        },
        () => ({ kind: "not-found" }),
      );
    },

    async permanentlyDelete(linkId, expectedRevision, confirmationAlias, context) {
      return retryStoredLinkMutation<PermanentlyDeleteResult>(
        database,
        linkId,
        "permanently delete Link",
        async (stored) => {
          if (stored.revision !== expectedRevision) {
            return { kind: "conflict", currentRevision: stored.revision };
          }
          if (stored.link.alias !== confirmationAlias) {
            return { kind: "confirmation-mismatch" };
          }
          if (stored.link.state !== "archived") {
            return { kind: "invalid-state", state: stored.link.state };
          }

          const results = await database.batch([
            database
              .prepare(
                `INSERT INTO audit_events
                 (id, actor_id, action, subject_id, occurred_at, metadata)
               SELECT ?, ?, ?, l.id, ?, ?
               FROM links l
               WHERE l.id = ? AND l.revision = ? AND l.state = 'archived'`,
              )
              .bind(
                generateAuditId(),
                context.actor.id,
                context.action,
                context.occurredAt.getTime(),
                JSON.stringify({ alias: stored.link.alias }),
                linkId,
                stored.revision,
              ),
            database
              .prepare(
                `UPDATE aliases
               SET link_id = NULL, deleted_link_id = ?, reserved_at = ?
               WHERE link_id = ?
                 AND EXISTS (
                   SELECT 1 FROM links
                   WHERE id = ? AND revision = ? AND state = 'archived'
                 )`,
              )
              .bind(linkId, context.occurredAt.getTime(), linkId, linkId, stored.revision),
            database
              .prepare(
                `DELETE FROM links
               WHERE id = ? AND revision = ? AND state = 'archived'`,
              )
              .bind(linkId, stored.revision),
          ]);
          if (changes(results[2]) > 0) {
            return {
              kind: "deleted",
              reservedAlias: {
                alias: stored.link.alias,
                deletedLinkId: stored.link.id,
                reservedAt: context.occurredAt,
              },
            };
          }
          return retryMutation;
        },
        () => ({ kind: "not-found" }),
      );
    },

    async releaseReservedAlias(alias, context) {
      const results = await database.batch([
        database
          .prepare(
            `INSERT INTO audit_events
               (id, actor_id, action, subject_id, occurred_at, metadata)
             SELECT ?, ?, ?, deleted_link_id, ?, ?
             FROM aliases
             WHERE alias = ? AND link_id IS NULL`,
          )
          .bind(
            generateAuditId(),
            context.actor.id,
            context.action,
            context.occurredAt.getTime(),
            JSON.stringify({ alias }),
            alias,
          ),
        database.prepare("DELETE FROM aliases WHERE alias = ? AND link_id IS NULL").bind(alias),
      ]);
      return changes(results[1]) === 1 ? "released" : "not-found";
    },

    async list(query) {
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
            : [
                query.cursor.createdAt.getTime(),
                query.cursor.createdAt.getTime(),
                query.cursor.id,
              ]),
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
    },

    async listDestinationVersions(linkId, query) {
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
    },

    async listReservedAliases(query) {
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
    },
  };
}

type LinkSummarySqlRow = {
  id: string;
  alias: string;
  title: string;
  state: LinkState;
  revision: number;
  createdAt: number;
  updatedAt: number;
  destinationVersionId: string;
  destination: string;
  versionNumber: number;
  destinationCreatedAt: number;
};

async function readStoredLink(
  database: D1Database,
  condition: "a.alias = ?" | "l.id = ?",
  value: string,
): Promise<StoredLink | null> {
  const results = await database.batch([
    database
      .prepare(
        `SELECT
           l.id,
           a.alias,
           l.title,
           l.state,
           l.revision,
           l.created_at AS createdAt,
           l.updated_at AS updatedAt
         FROM links l
         JOIN aliases a ON a.link_id = l.id
         WHERE ${condition}`,
      )
      .bind(value),
    database
      .prepare(
        `SELECT
           dv.id,
           dv.destination,
           dv.version_number AS versionNumber,
           dv.created_at AS createdAt
         FROM destination_versions dv
         JOIN links l ON l.id = dv.link_id
         JOIN aliases a ON a.link_id = l.id
         WHERE ${condition}
         ORDER BY dv.version_number DESC
         LIMIT 1`,
      )
      .bind(value),
  ]);
  const linkRow = rows<LinkRow>(results[0])[0];
  if (linkRow === undefined) return null;
  const versionRows = rows<DestinationVersionRow>(results[1]);
  if (versionRows.length === 0) {
    throw new Error(`Link ${linkRow.id} has no Destination Version`);
  }

  return {
    link: hydrateLink(linkRow, versionRows),
    revision: linkRow.revision,
    currentVersionNumber:
      versionRows[0]?.versionNumber ?? fail(`Link ${linkRow.id} has no Destination Version`),
  };
}

function readLinkStatements(database: D1Database, linkId: string) {
  return [
    database
      .prepare(
        `SELECT
           l.id,
           a.alias,
           l.title,
           l.state,
           l.revision,
           l.created_at AS createdAt,
           l.updated_at AS updatedAt
         FROM links l
         JOIN aliases a ON a.link_id = l.id
         WHERE l.id = ?`,
      )
      .bind(linkId),
    database
      .prepare(
        `SELECT
           id,
           destination,
           version_number AS versionNumber,
           created_at AS createdAt
         FROM destination_versions
         WHERE link_id = ?
         ORDER BY version_number DESC
         LIMIT 1`,
      )
      .bind(linkId),
  ] as const;
}

function hydrateBatchLink(
  results: D1Result[],
  linkResultIndex: number,
  versionsResultIndex: number,
): Link {
  const linkRow = rows<LinkRow>(results[linkResultIndex])[0];
  if (linkRow === undefined) {
    throw new Error("Mutated Link could not be reloaded");
  }
  return hydrateLink(linkRow, rows<DestinationVersionRow>(results[versionsResultIndex]));
}

function hydrateLink(row: LinkRow, versionRows: readonly DestinationVersionRow[]): Link {
  return {
    id: row.id,
    alias: assertAlias(row.alias),
    title: row.title,
    state: row.state,
    revision: row.revision,
    destinationVersions: versionRows.map(hydrateDestinationVersion),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function hydrateDestinationVersion(row: DestinationVersionRow): DestinationVersion {
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    destination: row.destination,
    createdAt: new Date(row.createdAt),
  };
}

function hydrateSummary(row: LinkSummarySqlRow) {
  return {
    id: row.id,
    alias: assertAlias(row.alias),
    title: row.title,
    state: row.state,
    revision: row.revision,
    currentDestinationVersion: {
      id: row.destinationVersionId,
      versionNumber: row.versionNumber,
      destination: row.destination,
      createdAt: new Date(row.destinationCreatedAt),
    },
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

async function findAlias(database: D1Database, alias: Alias) {
  return database
    .prepare(
      `SELECT link_id AS linkId
       FROM aliases
       WHERE alias = ?`,
    )
    .bind(alias)
    .first<{ linkId: string | null }>();
}

function insertAuditEvent(
  database: D1Database,
  id: string,
  context: LinkMutationContext,
  subjectId: string,
  metadata: Record<string, unknown>,
) {
  return database
    .prepare(
      `INSERT INTO audit_events
         (id, actor_id, action, subject_id, occurred_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      context.actor.id,
      context.action,
      subjectId,
      context.occurredAt.getTime(),
      JSON.stringify(metadata),
    );
}

function rows<Row>(result: D1Result | undefined): Row[] {
  return (result?.results ?? []) as Row[];
}

function changes(result: D1Result | undefined): number {
  return result?.meta.changes ?? 0;
}

function unchanged(link: Link): PersistedLinkMutation {
  return { kind: "updated", changed: false, link };
}

function updated(link: Link): PersistedLinkMutation {
  return { kind: "updated", changed: true, link };
}

async function retryStoredLinkMutation<Result>(
  database: D1Database,
  linkId: string,
  operation: string,
  mutate: (stored: StoredLink) => Promise<Result | typeof retryMutation>,
  notFound: () => Result,
): Promise<Result> {
  for (let attempt = 0; attempt < maximumMutationAttempts; attempt += 1) {
    const stored = await readStoredLink(database, "l.id = ?", linkId);
    if (stored === null) return notFound();

    const result = await mutate(stored);
    if (result !== retryMutation) return result;
  }
  throw concurrencyError(operation);
}

function assertAlias(value: string): Alias {
  const alias = parseAlias(value);
  if (alias === null) throw new Error(`Stored Alias is invalid: ${value}`);
  return alias;
}

function concurrencyError(operation: string): Error {
  return new Error(`Could not ${operation} after concurrent changes`);
}

function fail(message: string): never {
  throw new Error(message);
}
