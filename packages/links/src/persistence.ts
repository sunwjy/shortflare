import type {
  Actor,
  Alias,
  DestinationVersion,
  DestinationVersionPage,
  Link,
  LinkCommand,
  LinkPage,
  LinkSummary,
  LinkState,
  ReservedAlias,
  ReservedAliasPage,
} from "./types";

export type PersistenceListQuery = Readonly<{
  search: string;
  states: readonly LinkState[];
  limit: number;
  cursor?: Readonly<{
    createdAt: Date;
    id: string;
  }>;
}>;

export type PersistenceDestinationVersionQuery = Readonly<{
  limit: number;
  cursor?: Readonly<{ versionNumber: number }>;
}>;

export type PersistenceReservedAliasQuery = Readonly<{
  search: string;
  limit: number;
  cursor?: Readonly<{ reservedAt: Date; alias: Alias }>;
}>;

export type LinkMutationContext = Readonly<{
  actor: Actor;
  action: LinkCommand["kind"];
  occurredAt: Date;
}>;

export type PersistedLinkMutation =
  | Readonly<{ kind: "updated"; changed: boolean; link: Link }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "invalid-state"; state: LinkState }>
  | Readonly<{ kind: "conflict"; currentRevision: number }>;

/**
 * Storage seam consumed by the Links application module and implemented by
 * adapters. Mutations own their atomic persistence and Audit Event writes.
 */
export type LinksPersistence = {
  create(
    link: Link,
    context: LinkMutationContext,
  ): Promise<"created" | "alias-in-use" | "alias-reserved">;
  findByAlias(alias: Alias): Promise<Link | null>;
  findById(id: string): Promise<Link | null>;
  findSummariesByIds(ids: readonly string[]): Promise<readonly LinkSummary[]>;
  findReservedAlias(alias: Alias): Promise<ReservedAlias | null>;
  transitionState(
    linkId: string,
    expectedRevision: number,
    target: LinkState,
    allowedCurrentStates: readonly LinkState[],
    context: LinkMutationContext,
  ): Promise<PersistedLinkMutation>;
  edit(
    linkId: string,
    expectedRevision: number,
    values: Readonly<{
      title?: string;
      destinationVersion?: Omit<DestinationVersion, "versionNumber">;
    }>,
    context: LinkMutationContext,
  ): Promise<PersistedLinkMutation>;
  permanentlyDelete(
    linkId: string,
    expectedRevision: number,
    confirmationAlias: string,
    context: LinkMutationContext,
  ): Promise<
    | Readonly<{ kind: "deleted"; reservedAlias: ReservedAlias }>
    | Readonly<{ kind: "not-found" }>
    | Readonly<{ kind: "invalid-state"; state: LinkState }>
    | Readonly<{ kind: "conflict"; currentRevision: number }>
    | Readonly<{ kind: "confirmation-mismatch" }>
  >;
  releaseReservedAlias(
    alias: Alias,
    context: LinkMutationContext,
  ): Promise<"released" | "not-found">;
  list(query: PersistenceListQuery): Promise<LinkPage>;
  listDestinationVersions(
    linkId: string,
    query: PersistenceDestinationVersionQuery,
  ): Promise<DestinationVersionPage | null>;
  listReservedAliases(query: PersistenceReservedAliasQuery): Promise<ReservedAliasPage>;
};

export type CreateLinksOptions = Readonly<{
  persistence: LinksPersistence;
  redirectDomain: string;
  generateId?: () => string;
  generateAlias?: () => string;
  now?: () => Date;
}>;
