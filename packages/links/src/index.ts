export type Actor = Readonly<{
  id: string;
}>;

export type LinkState = "active" | "disabled" | "archived";

export type DestinationVersion = Readonly<{
  id: string;
  destination: string;
  createdAt: Date;
}>;

export type Link = Readonly<{
  id: string;
  alias: string;
  title: string;
  state: LinkState;
  destinationVersions: readonly DestinationVersion[];
  createdAt: Date;
  updatedAt: Date;
}>;

type CreateLinkCommand = Readonly<{
  kind: "create";
  alias?: string;
  title: string;
  destination: string;
}>;

type UpdateDestinationCommand = Readonly<{
  kind: "update-destination";
  linkId: string;
  destination: string;
}>;

type UpdateTitleCommand = Readonly<{
  kind: "update-title";
  linkId: string;
  title: string;
}>;

type StateCommandKind = "activate" | "disable" | "archive" | "restore";
type StateCommand = {
  [Kind in StateCommandKind]: Readonly<{
    kind: Kind;
    linkId: string;
  }>;
}[StateCommandKind];

type PermanentlyDeleteCommand = Readonly<{
  kind: "permanently-delete";
  linkId: string;
}>;

type ReleaseAliasCommand = Readonly<{
  kind: "release-alias";
  alias: string;
}>;

export type LinkCommand =
  | CreateLinkCommand
  | UpdateDestinationCommand
  | UpdateTitleCommand
  | StateCommand
  | PermanentlyDeleteCommand
  | ReleaseAliasCommand;

export type ReservedAlias = Readonly<{
  alias: string;
  deletedLinkId: string;
  reservedAt: Date;
}>;

export type LinkResult =
  | Readonly<{
      ok: true;
      kind: "link";
      changed: boolean;
      link: Link;
    }>
  | Readonly<{
      ok: true;
      kind: "deleted" | "released";
      alias: string;
    }>
  | Readonly<{
      ok: false;
      kind: "alias-in-use";
      alias: string;
    }>
  | Readonly<{
      ok: false;
      kind: "alias-reserved";
      alias: string;
    }>
  | Readonly<{
      ok: false;
      kind: "invalid-alias";
      alias: string;
    }>
  | Readonly<{
      ok: false;
      kind: "invalid-title";
    }>
  | Readonly<{
      ok: false;
      kind: "invalid-destination";
      reason: "malformed" | "unsupported-protocol" | "credentials" | "redirect-loop";
    }>
  | Readonly<{
      ok: false;
      kind: "link-not-found";
      linkId: string;
    }>
  | Readonly<{
      ok: false;
      kind: "invalid-state";
      command: Exclude<LinkCommand["kind"], "create">;
      state: LinkState;
    }>
  | Readonly<{
      ok: false;
      kind: "reserved-alias-not-found";
      alias: string;
    }>
  | Readonly<{
      ok: false;
      kind: "alias-generation-exhausted";
    }>;

export type RedirectDecision =
  | Readonly<{
      kind: "redirect";
      linkId: string;
      destinationVersionId: string;
      destination: string;
    }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "gone" }>;

export type LinkQuery =
  | Readonly<{ kind: "detail"; linkId: string }>
  | Readonly<{
      kind: "list";
      search?: string;
      states?: readonly LinkState[];
      limit?: number;
      cursor?: string;
    }>;

export type LinkPage = Readonly<{
  items: readonly Link[];
  nextCursor: string | null;
}>;

export type LinkQueryResult =
  | Readonly<{ ok: true; kind: "detail"; link: Link }>
  | Readonly<{ ok: true; kind: "page"; page: LinkPage }>
  | Readonly<{
      ok: false;
      kind: "link-not-found";
      linkId: string;
    }>;

type PersistenceListQuery = Readonly<{
  search: string;
  states: readonly LinkState[];
  limit: number;
  cursor?: string;
}>;

export type LinkMutationContext = Readonly<{
  actor: Actor;
  action: LinkCommand["kind"];
  occurredAt: Date;
}>;

export type LinksPersistence = {
  create(
    link: Link,
    context: LinkMutationContext,
  ): Promise<"created" | "alias-in-use" | "alias-reserved">;
  findByAlias(alias: string): Promise<Link | null>;
  findById(id: string): Promise<Link | null>;
  findReservedAlias(alias: string): Promise<ReservedAlias | null>;
  save(link: Link, context: LinkMutationContext): Promise<"saved" | "not-found">;
  deleteAndReserve(
    linkId: string,
    reservedAlias: ReservedAlias,
    context: LinkMutationContext,
  ): Promise<"deleted" | "not-found">;
  releaseReservedAlias(
    alias: string,
    context: LinkMutationContext,
  ): Promise<"released" | "not-found">;
  list(query: PersistenceListQuery): Promise<LinkPage>;
};

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
    async save(link, _context) {
      if (!linksById.has(link.id)) {
        return "not-found";
      }

      const stored = structuredClone(link);
      linksById.set(link.id, stored);
      linksByAlias.set(link.alias, stored);
      return "saved";
    },
    async deleteAndReserve(linkId, reservedAlias, _context) {
      const link = linksById.get(linkId);
      if (link === undefined) {
        return "not-found";
      }

      linksById.delete(linkId);
      linksByAlias.delete(link.alias);
      reservedAliases.set(reservedAlias.alias, structuredClone(reservedAlias));
      return "deleted";
    },
    async releaseReservedAlias(alias, _context) {
      return reservedAliases.delete(alias) ? "released" : "not-found";
    },
    async list(query) {
      const normalizedSearch = query.search.toLowerCase();
      const matching = Array.from(linksById.values())
        .filter(
          (link) =>
            query.states.includes(link.state) &&
            (normalizedSearch === "" ||
              link.alias.toLowerCase().includes(normalizedSearch) ||
              link.title.toLowerCase().includes(normalizedSearch)),
        )
        .toSorted(
          (left, right) =>
            right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id),
        );
      const cursorIndex =
        query.cursor === undefined
          ? 0
          : Math.max(0, matching.findIndex((link) => link.id === query.cursor) + 1);
      const items = matching.slice(cursorIndex, cursorIndex + query.limit);
      const hasMore = cursorIndex + items.length < matching.length;

      return {
        items: structuredClone(items),
        nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
      };
    },
  };
}

export type Links = {
  execute(command: LinkCommand, actor: Actor): Promise<LinkResult>;
  query(query: LinkQuery, actor: Actor): Promise<LinkQueryResult>;
  resolve(alias: string, incomingQuery?: string): Promise<RedirectDecision>;
};

type CreateLinksOptions = Readonly<{
  persistence: LinksPersistence;
  redirectDomain: string;
  generateId?: () => string;
  generateAlias?: () => string;
  now?: () => Date;
}>;

const aliasPattern = /^[A-Za-z0-9_-]{1,64}$/;

function mergeQuery(destination: string, incomingQuery: string): string {
  const url = new URL(destination);
  const storedNames = new Set(url.searchParams.keys());

  for (const [name, value] of new URLSearchParams(incomingQuery)) {
    if (!storedNames.has(name)) {
      url.searchParams.append(name, value);
    }
  }

  return url.href;
}

export function createLinks(options: CreateLinksOptions): Links {
  const generateId = options.generateId ?? (() => crypto.randomUUID());
  const generateAlias = options.generateAlias ?? (() => generateRandomAlias());
  const now = options.now ?? (() => new Date());

  return {
    async execute(command, actor) {
      if (command.kind === "release-alias") {
        if (!aliasPattern.test(command.alias)) {
          return {
            ok: false,
            kind: "invalid-alias",
            alias: command.alias,
          };
        }

        const occurredAt = now();
        const released = await options.persistence.releaseReservedAlias(command.alias, {
          actor,
          action: command.kind,
          occurredAt,
        });
        return released === "released"
          ? { ok: true, kind: "released", alias: command.alias }
          : {
              ok: false,
              kind: "reserved-alias-not-found",
              alias: command.alias,
            };
      }

      if (command.kind === "permanently-delete") {
        const link = await options.persistence.findById(command.linkId);
        if (link === null) {
          return {
            ok: false,
            kind: "link-not-found",
            linkId: command.linkId,
          };
        }
        if (link.state !== "archived") {
          return {
            ok: false,
            kind: "invalid-state",
            command: command.kind,
            state: link.state,
          };
        }

        const occurredAt = now();
        const deleted = await options.persistence.deleteAndReserve(
          link.id,
          {
            alias: link.alias,
            deletedLinkId: link.id,
            reservedAt: occurredAt,
          },
          { actor, action: command.kind, occurredAt },
        );
        return deleted === "deleted"
          ? { ok: true, kind: "deleted", alias: link.alias }
          : {
              ok: false,
              kind: "link-not-found",
              linkId: command.linkId,
            };
      }

      if (
        command.kind === "activate" ||
        command.kind === "disable" ||
        command.kind === "archive" ||
        command.kind === "restore"
      ) {
        const link = await options.persistence.findById(command.linkId);
        if (link === null) {
          return {
            ok: false,
            kind: "link-not-found",
            linkId: command.linkId,
          };
        }

        const targetState = transitionTarget(command.kind, link.state);
        if (targetState === "invalid") {
          return {
            ok: false,
            kind: "invalid-state",
            command: command.kind,
            state: link.state,
          };
        }
        if (targetState === link.state) {
          return { ok: true, kind: "link", changed: false, link };
        }

        const occurredAt = now();
        const updated: Link = {
          ...link,
          state: targetState,
          updatedAt: occurredAt,
        };
        const saved = await options.persistence.save(updated, {
          actor,
          action: command.kind,
          occurredAt,
        });
        if (saved === "not-found") {
          return {
            ok: false,
            kind: "link-not-found",
            linkId: command.linkId,
          };
        }

        return { ok: true, kind: "link", changed: true, link: updated };
      }

      if (command.kind === "update-title") {
        const link = await options.persistence.findById(command.linkId);
        if (link === null) {
          return {
            ok: false,
            kind: "link-not-found",
            linkId: command.linkId,
          };
        }
        if (link.state === "archived") {
          return {
            ok: false,
            kind: "invalid-state",
            command: command.kind,
            state: link.state,
          };
        }

        const title = normalizeTitle(command.title);
        if (title === null) {
          return { ok: false, kind: "invalid-title" };
        }
        if (title === link.title) {
          return { ok: true, kind: "link", changed: false, link };
        }

        const occurredAt = now();
        const updated: Link = { ...link, title, updatedAt: occurredAt };
        const saved = await options.persistence.save(updated, {
          actor,
          action: command.kind,
          occurredAt,
        });
        return saved === "saved"
          ? { ok: true, kind: "link", changed: true, link: updated }
          : {
              ok: false,
              kind: "link-not-found",
              linkId: command.linkId,
            };
      }

      if (command.kind === "update-destination") {
        const link = await options.persistence.findById(command.linkId);
        if (link === null) {
          return {
            ok: false,
            kind: "link-not-found",
            linkId: command.linkId,
          };
        }
        if (link.state === "archived") {
          return {
            ok: false,
            kind: "invalid-state",
            command: command.kind,
            state: link.state,
          };
        }

        const destinationResult = validateDestination(command.destination, options.redirectDomain);
        if (!destinationResult.ok) {
          return destinationResult;
        }

        const currentDestination = link.destinationVersions.at(-1);
        if (currentDestination?.destination === destinationResult.destination) {
          return { ok: true, kind: "link", changed: false, link };
        }

        const timestamp = now();
        const updated: Link = {
          ...link,
          destinationVersions: [
            ...link.destinationVersions,
            {
              id: generateId(),
              destination: destinationResult.destination,
              createdAt: timestamp,
            },
          ],
          updatedAt: timestamp,
        };
        const saved = await options.persistence.save(updated, {
          actor,
          action: command.kind,
          occurredAt: timestamp,
        });
        if (saved === "not-found") {
          return {
            ok: false,
            kind: "link-not-found",
            linkId: command.linkId,
          };
        }

        return { ok: true, kind: "link", changed: true, link: updated };
      }

      const title = normalizeTitle(command.title);
      if (title === null) {
        return { ok: false, kind: "invalid-title" };
      }

      const destinationResult = validateDestination(command.destination, options.redirectDomain);
      if (!destinationResult.ok) {
        return destinationResult;
      }

      const destination = destinationResult.destination;
      const attemptCount = command.alias === undefined ? 32 : 1;
      for (let attempt = 0; attempt < attemptCount; attempt += 1) {
        const alias = command.alias ?? generateAlias();
        if (!aliasPattern.test(alias)) {
          if (command.alias !== undefined) {
            return { ok: false, kind: "invalid-alias", alias };
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
              destination,
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
    async resolve(alias, incomingQuery = "") {
      if (!aliasPattern.test(alias)) {
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

function normalizeTitle(value: string): string | null {
  const title = value.trim();
  return title.length === 0 ||
    Array.from(title).length > 200 ||
    Array.from(title).some(isControlCharacter)
    ? null
    : title;
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return (
    codePoint !== undefined &&
    ((codePoint >= 0 && codePoint <= 31) || (codePoint >= 127 && codePoint <= 159))
  );
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

function transitionTarget(command: StateCommand["kind"], state: LinkState): LinkState | "invalid" {
  switch (command) {
    case "activate":
      return state === "active" ? state : state === "disabled" ? "active" : "invalid";
    case "disable":
      return state === "disabled" ? state : state === "active" ? "disabled" : "invalid";
    case "archive":
      return "archived";
    case "restore":
      return state === "archived" ? "disabled" : "invalid";
  }
}

function validateDestination(
  value: string,
  redirectDomain: string,
):
  | Readonly<{ ok: true; destination: string }>
  | Extract<LinkResult, { kind: "invalid-destination" }> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, kind: "invalid-destination", reason: "malformed" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      kind: "invalid-destination",
      reason: "unsupported-protocol",
    };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, kind: "invalid-destination", reason: "credentials" };
  }

  if (normalizeHostname(url.hostname) === normalizeHostname(redirectDomain)) {
    return { ok: false, kind: "invalid-destination", reason: "redirect-loop" };
  }

  return { ok: true, destination: url.href };
}

function generateRandomAlias(): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const characters: string[] = [];
  while (characters.length < 6) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    for (const byte of bytes) {
      if (byte < 248) {
        characters.push(alphabet[byte % alphabet.length] ?? "");
        if (characters.length === 6) {
          break;
        }
      }
    }
  }

  return characters.join("");
}
