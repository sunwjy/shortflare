import { foldCase } from "@shortflare/links";
import type { LinksPersistence, PersistedLinkMutation } from "@shortflare/links/persistence";
import { and, eq, exists, ne, sql } from "drizzle-orm";

import { createD1Database, databaseSchema } from "../d1";
import { listDestinationVersions, listLinks, listReservedAliases } from "./d1-links-pagination";
import {
  assertAlias,
  changes,
  findAlias,
  hydrateBatchLink,
  insertAuditEvent,
  readLinkStatements,
  readStoredLink,
  retryMutation,
  retryStoredLinkMutation,
  unchanged,
  updated,
} from "./d1-links-records";

type PermanentlyDeleteResult = Awaited<ReturnType<LinksPersistence["permanentlyDelete"]>>;

export type CreateD1LinksPersistenceOptions = Readonly<{
  generateAuditId?: () => string;
}>;

/**
 * D1 adapter for the Links persistence seam.
 *
 * Mutations keep the Link change and Audit Event in one D1 batch. Optimistic
 * conflicts are reported through the interface; storage corruption and
 * exhausted internal retries throw because callers cannot safely reinterpret
 * either condition as a domain result.
 */
export function createD1LinksPersistence(
  binding: D1Database,
  options: CreateD1LinksPersistenceOptions = {},
): LinksPersistence {
  const database = createD1Database(binding);
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
          database.insert(databaseSchema.links).values({
            id: link.id,
            title: link.title,
            searchTitle: foldCase(link.title),
            state: link.state,
            revision: 0,
            createdAt: link.createdAt,
            updatedAt: link.updatedAt,
          }),
          database.insert(databaseSchema.aliases).values({
            alias: link.alias,
            searchAlias: foldCase(link.alias),
            linkId: link.id,
          }),
          database.insert(databaseSchema.destinationVersions).values({
            id: destinationVersion.id,
            linkId: link.id,
            versionNumber: 1,
            destination: destinationVersion.destination,
            createdAt: destinationVersion.createdAt,
          }),
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
      const stored = await readStoredLink(database, { kind: "alias", value: alias });
      return stored?.link ?? null;
    },

    async findById(id) {
      const stored = await readStoredLink(database, { kind: "id", value: id });
      return stored?.link ?? null;
    },

    async findReservedAlias(alias) {
      const rows = await database
        .select({
          alias: databaseSchema.aliases.alias,
          deletedLinkId: databaseSchema.aliases.deletedLinkId,
          reservedAt: databaseSchema.aliases.reservedAt,
        })
        .from(databaseSchema.aliases)
        .where(
          and(
            eq(databaseSchema.aliases.alias, alias),
            sql`${databaseSchema.aliases.linkId} IS NULL`,
          ),
        )
        .limit(1);
      const row = rows[0];
      if (row === undefined) return null;
      if (row.deletedLinkId === null || row.reservedAt === null) {
        throw new Error(`Reserved Alias ${row.alias} is incomplete`);
      }

      return {
        alias: assertAlias(row.alias),
        deletedLinkId: row.deletedLinkId,
        reservedAt: row.reservedAt,
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
            database.insert(databaseSchema.auditEvents).select(
              database
                .select({
                  id: sql<string>`${generateAuditId()}`.as("id"),
                  actorId: sql<string>`${context.actor.id}`.as("actor_id"),
                  action: sql<typeof context.action>`${context.action}`.as("action"),
                  subjectId: databaseSchema.links.id,
                  occurredAt: sql<Date>`${context.occurredAt.getTime()}`.as("occurred_at"),
                  metadata: sql<{
                    fromState: typeof stored.link.state;
                    toState: typeof target;
                  }>`${JSON.stringify({ fromState: stored.link.state, toState: target })}`.as(
                    "metadata",
                  ),
                })
                .from(databaseSchema.links)
                .where(
                  and(
                    eq(databaseSchema.links.id, linkId),
                    eq(databaseSchema.links.revision, stored.revision),
                    eq(databaseSchema.links.state, stored.link.state),
                  ),
                ),
            ),
            database
              .update(databaseSchema.links)
              .set({
                state: target,
                updatedAt: context.occurredAt,
                revision: sql`${databaseSchema.links.revision} + 1`,
              })
              .where(
                and(
                  eq(databaseSchema.links.id, linkId),
                  eq(databaseSchema.links.revision, stored.revision),
                  eq(databaseSchema.links.state, stored.link.state),
                ),
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
            ...(titleChanged ? (["title"] as const) : []),
            ...(destinationChanged ? (["destination"] as const) : []),
          ];
          const metadata = {
            changedFields,
            ...(destinationChanged ? { destinationVersionId: values.destinationVersion!.id } : {}),
          };
          const audit = database.insert(databaseSchema.auditEvents).select(
            database
              .select({
                id: sql<string>`${generateAuditId()}`.as("id"),
                actorId: sql<string>`${context.actor.id}`.as("actor_id"),
                action: sql<typeof context.action>`${context.action}`.as("action"),
                subjectId: databaseSchema.links.id,
                occurredAt: sql<Date>`${context.occurredAt.getTime()}`.as("occurred_at"),
                metadata: sql<typeof metadata>`${JSON.stringify(metadata)}`.as("metadata"),
              })
              .from(databaseSchema.links)
              .where(
                and(
                  eq(databaseSchema.links.id, linkId),
                  eq(databaseSchema.links.revision, stored.revision),
                  ne(databaseSchema.links.state, "archived"),
                ),
              ),
          );
          const update = database
            .update(databaseSchema.links)
            .set({
              title,
              searchTitle: foldCase(title),
              updatedAt: context.occurredAt,
              revision: sql`${databaseSchema.links.revision} + 1`,
            })
            .where(
              and(
                eq(databaseSchema.links.id, linkId),
                eq(databaseSchema.links.revision, stored.revision),
                ne(databaseSchema.links.state, "archived"),
              ),
            );
          const reads = readLinkStatements(database, linkId);

          if (destinationChanged) {
            const destination = values.destinationVersion!;
            const results = await database.batch([
              audit,
              database.insert(databaseSchema.destinationVersions).select(
                database
                  .select({
                    id: sql<string>`${destination.id}`.as("id"),
                    linkId: databaseSchema.links.id,
                    versionNumber: sql<number>`${stored.currentVersionNumber + 1}`.as(
                      "version_number",
                    ),
                    destination: sql<string>`${destination.destination}`.as("destination"),
                    createdAt: sql<Date>`${destination.createdAt.getTime()}`.as("created_at"),
                  })
                  .from(databaseSchema.links)
                  .where(
                    and(
                      eq(databaseSchema.links.id, linkId),
                      eq(databaseSchema.links.revision, stored.revision),
                      ne(databaseSchema.links.state, "archived"),
                    ),
                  ),
              ),
              update,
              ...reads,
            ]);
            if (changes(results[2]) === 1) {
              return updated(hydrateBatchLink(results, 3, 4));
            }
            return retryMutation;
          }

          const results = await database.batch([audit, update, ...reads]);
          if (changes(results[1]) === 1) {
            return updated(hydrateBatchLink(results, 2, 3));
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

          const guardedLink = database
            .select({ value: sql`1` })
            .from(databaseSchema.links)
            .where(
              and(
                eq(databaseSchema.links.id, linkId),
                eq(databaseSchema.links.revision, stored.revision),
                eq(databaseSchema.links.state, "archived"),
              ),
            );
          const results = await database.batch([
            database.insert(databaseSchema.auditEvents).select(
              database
                .select({
                  id: sql<string>`${generateAuditId()}`.as("id"),
                  actorId: sql<string>`${context.actor.id}`.as("actor_id"),
                  action: sql<typeof context.action>`${context.action}`.as("action"),
                  subjectId: databaseSchema.links.id,
                  occurredAt: sql<Date>`${context.occurredAt.getTime()}`.as("occurred_at"),
                  metadata: sql<{ alias: string }>`${JSON.stringify({
                    alias: stored.link.alias,
                  })}`.as("metadata"),
                })
                .from(databaseSchema.links)
                .where(
                  and(
                    eq(databaseSchema.links.id, linkId),
                    eq(databaseSchema.links.revision, stored.revision),
                    eq(databaseSchema.links.state, "archived"),
                  ),
                ),
            ),
            database
              .update(databaseSchema.aliases)
              .set({
                linkId: null,
                deletedLinkId: linkId,
                reservedAt: context.occurredAt,
              })
              .where(and(eq(databaseSchema.aliases.linkId, linkId), exists(guardedLink))),
            database
              .delete(databaseSchema.links)
              .where(
                and(
                  eq(databaseSchema.links.id, linkId),
                  eq(databaseSchema.links.revision, stored.revision),
                  eq(databaseSchema.links.state, "archived"),
                ),
              ),
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
        database.insert(databaseSchema.auditEvents).select(
          database
            .select({
              id: sql<string>`${generateAuditId()}`.as("id"),
              actorId: sql<string>`${context.actor.id}`.as("actor_id"),
              action: sql<typeof context.action>`${context.action}`.as("action"),
              subjectId: sql<string>`${databaseSchema.aliases.deletedLinkId}`.as("subject_id"),
              occurredAt: sql<Date>`${context.occurredAt.getTime()}`.as("occurred_at"),
              metadata: sql<{ alias: string }>`${JSON.stringify({ alias })}`.as("metadata"),
            })
            .from(databaseSchema.aliases)
            .where(
              and(
                eq(databaseSchema.aliases.alias, alias),
                sql`${databaseSchema.aliases.linkId} IS NULL`,
              ),
            ),
        ),
        database
          .delete(databaseSchema.aliases)
          .where(
            and(
              eq(databaseSchema.aliases.alias, alias),
              sql`${databaseSchema.aliases.linkId} IS NULL`,
            ),
          ),
      ]);
      return changes(results[1]) === 1 ? "released" : "not-found";
    },

    list(query) {
      return listLinks(database, query);
    },

    listDestinationVersions(linkId, query) {
      return listDestinationVersions(database, linkId, query);
    },

    listReservedAliases(query) {
      return listReservedAliases(database, query);
    },
  };
}
