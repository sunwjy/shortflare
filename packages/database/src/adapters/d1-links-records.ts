import type { Alias, DestinationVersion, Link, LinkState, LinkSummary } from "@shortflare/links";
import { parseAlias } from "@shortflare/links";
import type { LinkMutationContext, PersistedLinkMutation } from "@shortflare/links/persistence";
import { desc, eq } from "drizzle-orm";

import { databaseSchema, type ShortflareDatabase } from "../d1";
import type { AuditMetadata } from "../schema";

type LinkRow = {
  id: string;
  alias: string;
  title: string;
  state: LinkState;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};

export type DestinationVersionRow = {
  id: string;
  destination: string;
  versionNumber: number;
  createdAt: Date;
};

export type StoredLink = Readonly<{
  link: Link;
  revision: number;
  currentVersionNumber: number;
}>;

export type LinkSummarySqlRow = LinkRow & {
  destinationVersionId: string;
  destination: string;
  versionNumber: number;
  destinationCreatedAt: Date;
};

type LinkLookup =
  | Readonly<{ kind: "alias"; value: Alias }>
  | Readonly<{ kind: "id"; value: string }>;

export const retryMutation = Symbol("retry-mutation");
const maximumMutationAttempts = 3;

export async function readStoredLink(
  database: ShortflareDatabase,
  lookup: LinkLookup,
): Promise<StoredLink | null> {
  const predicate =
    lookup.kind === "alias"
      ? eq(databaseSchema.aliases.alias, lookup.value)
      : eq(databaseSchema.links.id, lookup.value);
  const results = await database.batch([
    database
      .select({
        id: databaseSchema.links.id,
        alias: databaseSchema.aliases.alias,
        title: databaseSchema.links.title,
        state: databaseSchema.links.state,
        revision: databaseSchema.links.revision,
        createdAt: databaseSchema.links.createdAt,
        updatedAt: databaseSchema.links.updatedAt,
      })
      .from(databaseSchema.links)
      .innerJoin(databaseSchema.aliases, eq(databaseSchema.aliases.linkId, databaseSchema.links.id))
      .where(predicate),
    database
      .select({
        id: databaseSchema.destinationVersions.id,
        destination: databaseSchema.destinationVersions.destination,
        versionNumber: databaseSchema.destinationVersions.versionNumber,
        createdAt: databaseSchema.destinationVersions.createdAt,
      })
      .from(databaseSchema.destinationVersions)
      .innerJoin(
        databaseSchema.links,
        eq(databaseSchema.links.id, databaseSchema.destinationVersions.linkId),
      )
      .innerJoin(databaseSchema.aliases, eq(databaseSchema.aliases.linkId, databaseSchema.links.id))
      .where(predicate)
      .orderBy(desc(databaseSchema.destinationVersions.versionNumber))
      .limit(1),
  ]);
  const linkRow = results[0][0];
  if (linkRow === undefined) return null;
  const versionRows = results[1];
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

export function readLinkStatements(database: ShortflareDatabase, linkId: string) {
  return [
    database
      .select({
        id: databaseSchema.links.id,
        alias: databaseSchema.aliases.alias,
        title: databaseSchema.links.title,
        state: databaseSchema.links.state,
        revision: databaseSchema.links.revision,
        createdAt: databaseSchema.links.createdAt,
        updatedAt: databaseSchema.links.updatedAt,
      })
      .from(databaseSchema.links)
      .innerJoin(databaseSchema.aliases, eq(databaseSchema.aliases.linkId, databaseSchema.links.id))
      .where(eq(databaseSchema.links.id, linkId)),
    database
      .select({
        id: databaseSchema.destinationVersions.id,
        destination: databaseSchema.destinationVersions.destination,
        versionNumber: databaseSchema.destinationVersions.versionNumber,
        createdAt: databaseSchema.destinationVersions.createdAt,
      })
      .from(databaseSchema.destinationVersions)
      .where(eq(databaseSchema.destinationVersions.linkId, linkId))
      .orderBy(desc(databaseSchema.destinationVersions.versionNumber))
      .limit(1),
  ] as const;
}

export function hydrateBatchLink(
  results: readonly unknown[],
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function hydrateDestinationVersion(row: DestinationVersionRow): DestinationVersion {
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    destination: row.destination,
    createdAt: row.createdAt,
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
      createdAt: row.destinationCreatedAt,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findAlias(database: ShortflareDatabase, alias: Alias) {
  const aliasRows = await database
    .select({ linkId: databaseSchema.aliases.linkId })
    .from(databaseSchema.aliases)
    .where(eq(databaseSchema.aliases.alias, alias))
    .limit(1);
  return aliasRows[0] ?? null;
}

export function insertAuditEvent(
  database: ShortflareDatabase,
  id: string,
  context: LinkMutationContext,
  subjectId: string,
  metadata: AuditMetadata,
) {
  return database.insert(databaseSchema.auditEvents).values({
    id,
    actorId: context.actor.id,
    action: context.action,
    subjectId,
    occurredAt: context.occurredAt,
    metadata,
  });
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
  database: ShortflareDatabase,
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
  const stored = await readStoredLink(database, { kind: "id", value: linkId });
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

function rows<Row>(result: unknown): Row[] {
  return Array.isArray(result) ? (result as Row[]) : [];
}

function fail(message: string): never {
  throw new Error(message);
}
