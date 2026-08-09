import type { EditLinkCommand, Link, LinkResult, Links, StateCommand, LinkState } from "./types";
import type {
  CreateLinksOptions,
  PersistedLinkMutation,
  PersistenceListQuery,
} from "./persistence";
import {
  generateRandomAlias,
  decodeDestinationVersionCursor,
  decodeReservedAliasCursor,
  decodeListCursor,
  foldCase,
  mergeQuery,
  normalizeTitle,
  parseAlias,
  validateDestination,
} from "./values";

/**
 * Creates the Links application module.
 *
 * The interface owns Link invariants, commands, pagination cursors, and redirect
 * decisions. Its persistence adapter owns storage and atomicity; callers own
 * authorization and transport effects. Every command returns a discriminated
 * result instead of throwing for an expected domain rejection.
 */
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
        if (command.confirmationAlias !== alias) {
          return { ok: false, kind: "confirmation-mismatch" };
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
        const deleted = await options.persistence.permanentlyDelete(
          command.linkId,
          command.expectedRevision,
          command.confirmationAlias,
          {
            actor,
            action: command.kind,
            occurredAt,
          },
        );
        switch (deleted.kind) {
          case "deleted":
            return { ok: true, kind: "deleted", reservedAlias: deleted.reservedAlias };
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
          case "conflict":
            return {
              ok: false,
              kind: "link-conflict",
              currentRevision: deleted.currentRevision,
            };
          case "confirmation-mismatch":
            return { ok: false, kind: "confirmation-mismatch" };
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
          command.expectedRevision,
          rule.target,
          rule.allowedCurrentStates,
          { actor, action: command.kind, occurredAt },
        );
        return persistedMutationResult(persisted, command);
      }

      if (command.kind === "edit") {
        const values: {
          title?: string;
          destinationVersion?: {
            id: string;
            destination: string;
            createdAt: Date;
          };
        } = {};
        if (command.title !== undefined) {
          const title = normalizeTitle(command.title);
          if (title === null) {
            return { ok: false, kind: "invalid-title" };
          }
          values.title = title;
        }
        if (command.destination !== undefined) {
          const destinationResult = validateDestination(
            command.destination,
            options.redirectDomain,
          );
          if (!destinationResult.ok) {
            return destinationResult;
          }
          values.destinationVersion = {
            id: generateId(),
            destination: destinationResult.destination,
            createdAt: now(),
          };
        }

        const occurredAt = now();
        const persisted = await options.persistence.edit(
          command.linkId,
          command.expectedRevision,
          values,
          { actor, action: command.kind, occurredAt },
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
      const attemptCreate = async (attempt: number): Promise<LinkResult> => {
        if (attempt >= attemptCount) {
          return { ok: false, kind: "alias-generation-exhausted" };
        }

        const aliasInput = command.alias ?? generateAlias();
        const alias = parseAlias(aliasInput);
        if (alias === null) {
          if (command.alias !== undefined) {
            return { ok: false, kind: "invalid-alias", alias: aliasInput };
          }
          return attemptCreate(attempt + 1);
        }

        const timestamp = now();
        const link: Link = {
          id: generateId(),
          alias,
          title,
          state: "active",
          revision: 0,
          destinationVersions: [
            {
              id: generateId(),
              versionNumber: 1,
              destination: destinationResult.destination,
              createdAt: timestamp,
            },
          ],
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        // create() performs the authoritative collision check, so generated
        // candidates must be tried sequentially rather than with Promise.all.
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
        return attemptCreate(attempt + 1);
      };

      return attemptCreate(0);
    },
    async query(query) {
      if (query.kind === "summaries") {
        return {
          ok: true,
          kind: "summaries",
          items: await options.persistence.findSummariesByIds(query.linkIds),
        };
      }

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

      if (query.kind === "destination-versions") {
        const cursor =
          query.cursor === undefined
            ? undefined
            : decodeDestinationVersionCursor(query.cursor, query.linkId);
        if (cursor === null) {
          return { ok: false, kind: "invalid-cursor" };
        }
        const page = await options.persistence.listDestinationVersions(query.linkId, {
          limit: Math.max(1, Math.min(100, query.limit ?? 50)),
          ...(cursor === undefined ? {} : { cursor }),
        });
        return page === null
          ? { ok: false, kind: "link-not-found", linkId: query.linkId }
          : { ok: true, kind: "destination-version-page", page };
      }

      if (query.kind === "reserved-aliases") {
        const search = foldCase(query.search?.trim() ?? "");
        const cursor =
          query.cursor === undefined ? undefined : decodeReservedAliasCursor(query.cursor, search);
        if (cursor === null) {
          return { ok: false, kind: "invalid-cursor" };
        }
        return {
          ok: true,
          kind: "reserved-alias-page",
          page: await options.persistence.listReservedAliases({
            search,
            limit: Math.max(1, Math.min(100, query.limit ?? 50)),
            ...(cursor === undefined ? {} : { cursor }),
          }),
        };
      }

      const search = foldCase(query.search?.trim() ?? "");
      const states = canonicalStates(query.states ?? ["active", "disabled"]);
      const cursor =
        query.cursor === undefined ? undefined : decodeListCursor(query.cursor, search, states);
      if (cursor === null) {
        return { ok: false, kind: "invalid-cursor" };
      }

      const listQuery: PersistenceListQuery = {
        search,
        states,
        limit: Math.max(1, Math.min(100, query.limit ?? 50)),
        ...(cursor === undefined ? {} : { cursor }),
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

function canonicalStates(states: readonly LinkState[]): readonly LinkState[] {
  const selected = new Set(states);
  return (["active", "disabled", "archived"] as const).filter((state) => selected.has(state));
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
  command: StateCommand | EditLinkCommand,
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
    case "conflict":
      return {
        ok: false,
        kind: "link-conflict",
        currentRevision: persisted.currentRevision,
      };
  }
}
