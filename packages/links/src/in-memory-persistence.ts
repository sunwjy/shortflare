import type { Link, LinksPersistence, ReservedAlias } from "./types";
import { encodeListCursor, foldCase } from "./values";

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
      return link === undefined ? null : structuredClone(link);
    },
    async findById(id) {
      const link = linksById.get(id);
      return link === undefined ? null : structuredClone(link);
    },
    async findReservedAlias(alias) {
      const reservedAlias = reservedAliases.get(alias);
      return reservedAlias === undefined ? null : structuredClone(reservedAlias);
    },
    async transitionState(linkId, target, allowedCurrentStates, context) {
      const link = linksById.get(linkId);
      if (link === undefined) {
        return { kind: "not-found" };
      }
      if (!allowedCurrentStates.includes(link.state)) {
        return { kind: "invalid-state", state: link.state };
      }
      if (link.state === target) {
        return { kind: "updated", changed: false, link: structuredClone(link) };
      }

      const updated: Link = {
        ...link,
        state: target,
        updatedAt: context.occurredAt,
      };
      linksById.set(linkId, updated);
      linksByAlias.set(link.alias, updated);
      return { kind: "updated", changed: true, link: structuredClone(updated) };
    },
    async updateTitle(linkId, title, context) {
      const link = linksById.get(linkId);
      if (link === undefined) {
        return { kind: "not-found" };
      }
      if (link.state === "archived") {
        return { kind: "invalid-state", state: link.state };
      }
      if (link.title === title) {
        return { kind: "updated", changed: false, link: structuredClone(link) };
      }

      const updated: Link = { ...link, title, updatedAt: context.occurredAt };
      linksById.set(linkId, updated);
      linksByAlias.set(link.alias, updated);
      return { kind: "updated", changed: true, link: structuredClone(updated) };
    },
    async appendDestinationVersion(linkId, destinationVersion, context) {
      const link = linksById.get(linkId);
      if (link === undefined) {
        return { kind: "not-found" };
      }
      if (link.state === "archived") {
        return { kind: "invalid-state", state: link.state };
      }
      if (link.destinationVersions.at(-1)?.destination === destinationVersion.destination) {
        return { kind: "updated", changed: false, link: structuredClone(link) };
      }

      const updated: Link = {
        ...link,
        destinationVersions: [...link.destinationVersions, destinationVersion],
        updatedAt: context.occurredAt,
      };
      linksById.set(linkId, updated);
      linksByAlias.set(link.alias, updated);
      return { kind: "updated", changed: true, link: structuredClone(updated) };
    },
    async permanentlyDelete(linkId, context) {
      const link = linksById.get(linkId);
      if (link === undefined) {
        return { kind: "not-found" };
      }
      if (link.state !== "archived") {
        return { kind: "invalid-state", state: link.state };
      }

      linksById.delete(linkId);
      linksByAlias.delete(link.alias);
      reservedAliases.set(link.alias, {
        alias: link.alias,
        deletedLinkId: link.id,
        reservedAt: context.occurredAt,
      });
      return { kind: "deleted", alias: link.alias };
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
            right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id),
        );
      const afterCursor =
        query.cursor === undefined
          ? matching
          : matching.filter(
              (link) =>
                link.updatedAt < query.cursor!.updatedAt ||
                (link.updatedAt.getTime() === query.cursor!.updatedAt.getTime() &&
                  link.id.localeCompare(query.cursor!.id) > 0),
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
            ? encodeListCursor({
                updatedAt: lastItem.updatedAt,
                id: lastItem.id,
              })
            : null,
      };
    },
  };
}
