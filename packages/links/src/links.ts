import type {
  CreateLinksOptions,
  Link,
  LinkResult,
  Links,
  PersistedLinkMutation,
  PersistenceListQuery,
  StateCommand,
  UpdateDestinationCommand,
  UpdateTitleCommand,
  LinkState,
} from "./types";
import {
  generateRandomAlias,
  mergeQuery,
  normalizeTitle,
  parseAlias,
  validateDestination,
} from "./values";

export function createLinks(options: CreateLinksOptions): Links {
  const generateId = options.generateId ?? (() => crypto.randomUUID());
  const generateAlias = options.generateAlias ?? (() => generateRandomAlias());
  const now = options.now ?? (() => new Date());

  return {
    async execute(command, actor) {
      if (command.kind === "release-alias") {
        const alias = parseAlias(command.alias);
        if (alias === null) {
          return {
            ok: false,
            kind: "invalid-alias",
            alias: command.alias,
          };
        }

        const occurredAt = now();
        const released = await options.persistence.releaseReservedAlias(alias, {
          actor,
          action: command.kind,
          occurredAt,
        });
        return released === "released"
          ? { ok: true, kind: "released", alias }
          : {
              ok: false,
              kind: "reserved-alias-not-found",
              alias,
            };
      }

      if (command.kind === "permanently-delete") {
        const occurredAt = now();
        const deleted = await options.persistence.permanentlyDelete(command.linkId, {
          actor,
          action: command.kind,
          occurredAt,
        });
        switch (deleted.kind) {
          case "deleted":
            return { ok: true, kind: "deleted", alias: deleted.alias };
          case "not-found":
            return {
              ok: false,
              kind: "link-not-found",
              linkId: command.linkId,
            };
          case "invalid-state":
            return {
              ok: false,
              kind: "invalid-state",
              command: command.kind,
              state: deleted.state,
            };
        }
      }

      if (
        command.kind === "activate" ||
        command.kind === "disable" ||
        command.kind === "archive" ||
        command.kind === "restore"
      ) {
        const occurredAt = now();
        const rule = transitionRule(command.kind);
        const persisted = await options.persistence.transitionState(
          command.linkId,
          rule.target,
          rule.allowedCurrentStates,
          { actor, action: command.kind, occurredAt },
        );
        return persistedMutationResult(persisted, command);
      }

      if (command.kind === "update-title") {
        const title = normalizeTitle(command.title);
        if (title === null) {
          return { ok: false, kind: "invalid-title" };
        }

        const occurredAt = now();
        const persisted = await options.persistence.updateTitle(command.linkId, title, {
          actor,
          action: command.kind,
          occurredAt,
        });
        return persistedMutationResult(persisted, command);
      }

      if (command.kind === "update-destination") {
        const destinationResult = validateDestination(command.destination, options.redirectDomain);
        if (!destinationResult.ok) {
          return destinationResult;
        }

        const timestamp = now();
        const persisted = await options.persistence.appendDestinationVersion(
          command.linkId,
          {
            id: generateId(),
            destination: destinationResult.destination,
            createdAt: timestamp,
          },
          { actor, action: command.kind, occurredAt: timestamp },
        );
        return persistedMutationResult(persisted, command);
      }

      const title = normalizeTitle(command.title);
      if (title === null) {
        return { ok: false, kind: "invalid-title" };
      }

      const destinationResult = validateDestination(command.destination, options.redirectDomain);
      if (!destinationResult.ok) {
        return destinationResult;
      }

      const attemptCount = command.alias === undefined ? 32 : 1;
      for (let attempt = 0; attempt < attemptCount; attempt += 1) {
        const aliasInput = command.alias ?? generateAlias();
        const alias = parseAlias(aliasInput);
        if (alias === null) {
          if (command.alias !== undefined) {
            return { ok: false, kind: "invalid-alias", alias: aliasInput };
          }
          continue;
        }

        const timestamp = now();
        const link: Link = {
          id: generateId(),
          alias,
          title,
          state: "active",
          destinationVersions: [
            {
              id: generateId(),
              destination: destinationResult.destination,
              createdAt: timestamp,
            },
          ],
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        // Generated Alias attempts are deliberately sequential: create()
        // performs the authoritative collision check for each candidate.
        // oxlint-disable-next-line no-await-in-loop
        const created = await options.persistence.create(link, {
          actor,
          action: command.kind,
          occurredAt: timestamp,
        });

        if (created === "created") {
          return { ok: true, kind: "link", changed: true, link };
        }
        if (command.alias !== undefined) {
          return created === "alias-in-use"
            ? { ok: false, kind: "alias-in-use", alias }
            : { ok: false, kind: "alias-reserved", alias };
        }
      }

      return { ok: false, kind: "alias-generation-exhausted" };
    },
    async query(query) {
      if (query.kind === "detail") {
        const link = await options.persistence.findById(query.linkId);
        return link === null
          ? {
              ok: false,
              kind: "link-not-found",
              linkId: query.linkId,
            }
          : { ok: true, kind: "detail", link };
      }

      const listQuery: PersistenceListQuery = {
        search: query.search ?? "",
        states: query.states ?? ["active", "disabled"],
        limit: Math.max(1, Math.min(100, query.limit ?? 50)),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      };
      return {
        ok: true,
        kind: "page",
        page: await options.persistence.list(listQuery),
      };
    },
    async resolve(aliasInput, incomingQuery = "") {
      const alias = parseAlias(aliasInput);
      if (alias === null) {
        return { kind: "not-found" };
      }

      const link = await options.persistence.findByAlias(alias);
      if (link === null) {
        return (await options.persistence.findReservedAlias(alias)) === null
          ? { kind: "not-found" }
          : { kind: "gone" };
      }
      if (link.state === "disabled") {
        return { kind: "not-found" };
      }
      if (link.state === "archived") {
        return { kind: "gone" };
      }

      const destinationVersion = link.destinationVersions.at(-1);
      if (destinationVersion === undefined) {
        return { kind: "not-found" };
      }

      return {
        kind: "redirect",
        linkId: link.id,
        destinationVersionId: destinationVersion.id,
        destination: mergeQuery(destinationVersion.destination, incomingQuery),
      };
    },
  };
}

function transitionRule(command: StateCommand["kind"]): Readonly<{
  target: LinkState;
  allowedCurrentStates: readonly LinkState[];
}> {
  switch (command) {
    case "activate":
      return { target: "active", allowedCurrentStates: ["active", "disabled"] };
    case "disable":
      return { target: "disabled", allowedCurrentStates: ["active", "disabled"] };
    case "archive":
      return {
        target: "archived",
        allowedCurrentStates: ["active", "disabled", "archived"],
      };
    case "restore":
      return { target: "disabled", allowedCurrentStates: ["archived"] };
  }
}

function persistedMutationResult(
  persisted: PersistedLinkMutation,
  command: StateCommand | UpdateTitleCommand | UpdateDestinationCommand,
): LinkResult {
  switch (persisted.kind) {
    case "updated":
      return {
        ok: true,
        kind: "link",
        changed: persisted.changed,
        link: persisted.link,
      };
    case "not-found":
      return {
        ok: false,
        kind: "link-not-found",
        linkId: command.linkId,
      };
    case "invalid-state":
      return {
        ok: false,
        kind: "invalid-state",
        command: command.kind,
        state: persisted.state,
      };
  }
}
