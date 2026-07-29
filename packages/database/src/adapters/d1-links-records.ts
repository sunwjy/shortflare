import type { Alias, DestinationVersion, Link, LinkState, LinkSummary } from "@shortflare/links";
import type { LinkMutationContext, PersistedLinkMutation } from "@shortflare/links/persistence";
import { parseAlias } from "@shortflare/links";

type LinkRow = {
  id: string;
  alias: string;
  title: string;
  state: LinkState;
  revision: number;
  createdAt: number;
  updatedAt: number;
};

export type DestinationVersionRow = {
  id: string;
  destination: string;
  versionNumber: number;
  createdAt: number;
};

export type StoredLink = Readonly<{
  link: Link;
  revision: number;
  currentVersionNumber: number;
}>;

export type LinkSummarySqlRow = {
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

export const retryMutation = Symbol("retry-mutation");
const maximumMutationAttempts = 3;

export async function readStoredLink(
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

export function readLinkStatements(database: D1Database, linkId: string) {
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

export function hydrateBatchLink(
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

export function hydrateDestinationVersion(row: DestinationVersionRow): DestinationVersion {
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    destination: row.destination,
    createdAt: new Date(row.createdAt),
  };
}

export function hydrateSummary(row: LinkSummarySqlRow): LinkSummary {
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

export async function findAlias(database: D1Database, alias: Alias) {
  return database
    .prepare(
      `SELECT link_id AS linkId
       FROM aliases
       WHERE alias = ?`,
    )
    .bind(alias)
    .first<{ linkId: string | null }>();
}

export function insertAuditEvent(
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

export function changes(result: D1Result | undefined): number {
  return result?.meta.changes ?? 0;
}

export function unchanged(link: Link): PersistedLinkMutation {
  return { kind: "updated", changed: false, link };
}

export function updated(link: Link): PersistedLinkMutation {
  return { kind: "updated", changed: true, link };
}

export async function retryStoredLinkMutation<Result>(
  database: D1Database,
  linkId: string,
  operation: string,
  mutate: (stored: StoredLink) => Promise<Result | typeof retryMutation>,
  notFound: () => Result,
  attempt = 0,
): Promise<Result> {
  if (attempt >= maximumMutationAttempts) {
    throw new Error(`Could not ${operation} after concurrent changes`);
  }

  // A retry must observe the committed result of the previous attempt. Recursion
  // makes that sequencing explicit without suppressing no-await-in-loop.
  const stored = await readStoredLink(database, "l.id = ?", linkId);
  if (stored === null) return notFound();

  const result = await mutate(stored);
  return result === retryMutation
    ? retryStoredLinkMutation(database, linkId, operation, mutate, notFound, attempt + 1)
    : result;
}

export function assertAlias(value: string): Alias {
  const alias = parseAlias(value);
  if (alias === null) throw new Error(`Stored Alias is invalid: ${value}`);
  return alias;
}

function rows<Row>(result: D1Result | undefined): Row[] {
  return (result?.results ?? []) as Row[];
}

function fail(message: string): never {
  throw new Error(message);
}
