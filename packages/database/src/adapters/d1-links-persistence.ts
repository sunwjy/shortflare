import type { LinksPersistence, PersistedLinkMutation } from "@shortflare/links/persistence";
import { foldCase } from "@shortflare/links";
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
import { listDestinationVersions, listLinks, listReservedAliases } from "./d1-links-pagination";

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
