import type { Link, LinksPersistence, ReservedAlias } from "./types";
import {
  encodeDestinationVersionCursor,
  encodeListCursor,
  encodeReservedAliasCursor,
  foldCase,
} from "./values";

export function createInMemoryLinksPersistence(): LinksPersistence {
  const linksByAlias = new Map<string, Link>();
  const linksById = new Map<string, Link>();
  const reservedAliases = new Map<string, ReservedAlias>();

  return {
    async create(link, _context) {
      if (linksByAlias.has(link.alias)) {
        return "alias-in-use";
      }
      if (reservedAliases.has(link.alias)) {
        return "alias-reserved";
      }

      const stored = structuredClone(link);
      linksByAlias.set(link.alias, stored);
      linksById.set(link.id, stored);
      return "created";
    },
    async findByAlias(alias) {
      const link = linksByAlias.get(alias);
      return link === undefined ? null : currentLinkSnapshot(link);
    },
    async findById(id) {
      const link = linksById.get(id);
      return link === undefined ? null : currentLinkSnapshot(link);
    },
    async findReservedAlias(alias) {
      const reservedAlias = reservedAliases.get(alias);
      return reservedAlias === undefined ? null : structuredClone(reservedAlias);
    },
    async transitionState(linkId, expectedRevision, target, allowedCurrentStates, context) {
      const link = linksById.get(linkId);
      if (link === undefined) {
        return { kind: "not-found" };
      }
      if (link.revision !== expectedRevision) {
        return { kind: "conflict", currentRevision: link.revision };
      }
      if (!allowedCurrentStates.includes(link.state)) {
        return { kind: "invalid-state", state: link.state };
      }
      if (link.state === target) {
        return { kind: "updated", changed: false, link: currentLinkSnapshot(link) };
      }

      const updated: Link = {
        ...link,
        state: target,
        revision: link.revision + 1,
        updatedAt: context.occurredAt,
      };
      linksById.set(linkId, updated);
      linksByAlias.set(link.alias, updated);
      return { kind: "updated", changed: true, link: currentLinkSnapshot(updated) };
    },
    async edit(linkId, expectedRevision, values, context) {
      const link = linksById.get(linkId);
      if (link === undefined) {
        return { kind: "not-found" };
      }
      if (link.revision !== expectedRevision) {
        return { kind: "conflict", currentRevision: link.revision };
      }
      if (link.state === "archived") {
        return { kind: "invalid-state", state: link.state };
      }

      const currentDestination = link.destinationVersions.at(-1);
      const title = values.title ?? link.title;
      const destinationChanged =
        values.destinationVersion !== undefined &&
        values.destinationVersion.destination !== currentDestination?.destination;
      const titleChanged = title !== link.title;
      if (!titleChanged && !destinationChanged) {
        return { kind: "updated", changed: false, link: currentLinkSnapshot(link) };
      }

      const updated: Link = {
        ...link,
        title,
        revision: link.revision + 1,
        destinationVersions: destinationChanged
          ? [
              ...link.destinationVersions,
              {
                ...values.destinationVersion!,
                versionNumber: (currentDestination?.versionNumber ?? 0) + 1,
              },
            ]
          : link.destinationVersions,
        updatedAt: context.occurredAt,
      };
      linksById.set(linkId, updated);
      linksByAlias.set(link.alias, updated);
      return { kind: "updated", changed: true, link: currentLinkSnapshot(updated) };
    },
    async permanentlyDelete(linkId, expectedRevision, confirmationAlias, context) {
      const link = linksById.get(linkId);
      if (link === undefined) {
        return { kind: "not-found" };
      }
      if (link.revision !== expectedRevision) {
        return { kind: "conflict", currentRevision: link.revision };
      }
      if (link.alias !== confirmationAlias) {
        return { kind: "confirmation-mismatch" };
      }
      if (link.state !== "archived") {
        return { kind: "invalid-state", state: link.state };
      }

      linksById.delete(linkId);
      linksByAlias.delete(link.alias);
      const reservedAlias: ReservedAlias = {
        alias: link.alias,
        deletedLinkId: link.id,
        reservedAt: context.occurredAt,
      };
      reservedAliases.set(link.alias, reservedAlias);
      return { kind: "deleted", reservedAlias: structuredClone(reservedAlias) };
    },
    async releaseReservedAlias(alias, _context) {
      return reservedAliases.delete(alias) ? "released" : "not-found";
    },
    async list(query) {
      const normalizedSearch = query.search;
      const matching = Array.from(linksById.values())
        .filter(
          (link) =>
            query.states.includes(link.state) &&
            (normalizedSearch === "" ||
              foldCase(link.alias).includes(normalizedSearch) ||
              foldCase(link.title).includes(normalizedSearch)),
        )
        .toSorted(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            compareCaseSensitive(left.id, right.id),
        );
      const afterCursor =
        query.cursor === undefined
          ? matching
          : matching.filter(
              (link) =>
                link.createdAt < query.cursor!.createdAt ||
                (link.createdAt.getTime() === query.cursor!.createdAt.getTime() &&
                  compareCaseSensitive(link.id, query.cursor!.id) > 0),
            );
      const pageLinks = afterCursor.slice(0, query.limit);
      const items = pageLinks.map((link) => {
        const currentDestinationVersion = link.destinationVersions.at(-1);
        if (currentDestinationVersion === undefined) {
          throw new Error(`Link ${link.id} has no Destination Version`);
        }
        return {
          id: link.id,
          alias: link.alias,
          title: link.title,
          state: link.state,
          revision: link.revision,
          currentDestinationVersion,
          createdAt: link.createdAt,
          updatedAt: link.updatedAt,
        };
      });
      const hasMore = pageLinks.length < afterCursor.length;
      const lastItem = items.at(-1);

      return {
        items: structuredClone(items),
        nextCursor:
          hasMore && lastItem !== undefined
            ? encodeListCursor(query.search, query.states, {
                createdAt: lastItem.createdAt,
                id: lastItem.id,
              })
            : null,
      };
    },
    async listDestinationVersions(linkId, query) {
      const link = linksById.get(linkId);
      if (link === undefined) return null;

      const matching = link.destinationVersions
        .toSorted((left, right) => right.versionNumber - left.versionNumber)
        .filter(
          (version) =>
            query.cursor === undefined || version.versionNumber < query.cursor.versionNumber,
        );
      const items = matching.slice(0, query.limit);
      const lastItem = items.at(-1);
      return {
        items: structuredClone(items),
        currentVersionNumber: link.destinationVersions.at(-1)!.versionNumber,
        nextCursor:
          matching.length > items.length && lastItem !== undefined
            ? encodeDestinationVersionCursor(linkId, lastItem.versionNumber)
            : null,
      };
    },
    async listReservedAliases(query) {
      const matching = Array.from(reservedAliases.values())
        .filter((reservedAlias) => foldCase(reservedAlias.alias).includes(query.search))
        .toSorted(
          (left, right) =>
            right.reservedAt.getTime() - left.reservedAt.getTime() ||
            compareCaseSensitive(left.alias, right.alias),
        )
        .filter(
          (reservedAlias) =>
            query.cursor === undefined ||
            reservedAlias.reservedAt < query.cursor.reservedAt ||
            (reservedAlias.reservedAt.getTime() === query.cursor.reservedAt.getTime() &&
              compareCaseSensitive(reservedAlias.alias, query.cursor.alias) > 0),
        );
      const items = matching.slice(0, query.limit);
      const lastItem = items.at(-1);
      return {
        items: structuredClone(items),
        nextCursor:
          matching.length > items.length && lastItem !== undefined
            ? encodeReservedAliasCursor(query.search, {
                reservedAt: lastItem.reservedAt,
                alias: lastItem.alias,
              })
            : null,
      };
    },
  };
}

function compareCaseSensitive(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function currentLinkSnapshot(link: Link): Link {
  const currentDestination = link.destinationVersions.at(-1);
  if (currentDestination === undefined) {
    throw new Error(`Link ${link.id} has no Destination Version`);
  }
  return structuredClone({
    ...link,
    destinationVersions: [currentDestination],
  });
}
