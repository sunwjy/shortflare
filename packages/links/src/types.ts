export type Alias = string & { readonly __aliasBrand: "Alias" };

export type Actor = Readonly<{
  id: string;
}>;

export type LinkState = "active" | "disabled" | "archived";

export type DestinationVersion = Readonly<{
  id: string;
  versionNumber: number;
  destination: string;
  createdAt: Date;
}>;

export type Link = Readonly<{
  id: string;
  alias: Alias;
  title: string;
  state: LinkState;
  revision: number;
  destinationVersions: readonly DestinationVersion[];
  createdAt: Date;
  updatedAt: Date;
}>;

export type LinkSummary = Readonly<{
  id: string;
  alias: Alias;
  title: string;
  state: LinkState;
  revision: number;
  currentDestinationVersion: DestinationVersion;
  createdAt: Date;
  updatedAt: Date;
}>;

export type CreateLinkCommand = Readonly<{
  kind: "create";
  alias?: string;
  title: string;
  destination: string;
}>;

export type EditLinkCommand = Readonly<
  {
    kind: "edit";
    linkId: string;
    expectedRevision: number;
  } & (
    | Readonly<{ title: string; destination?: string }>
    | Readonly<{ title?: string; destination: string }>
  )
>;

export type StateCommandKind = "activate" | "disable" | "archive" | "restore";
export type StateCommand = {
  [Kind in StateCommandKind]: Readonly<{
    kind: Kind;
    linkId: string;
    expectedRevision: number;
  }>;
}[StateCommandKind];

export type PermanentlyDeleteCommand = Readonly<{
  kind: "permanently-delete";
  linkId: string;
  expectedRevision: number;
  confirmationAlias: string;
}>;

export type ReleaseAliasCommand = Readonly<{
  kind: "release-alias";
  alias: string;
  confirmationAlias: string;
}>;

export type LinkCommand =
  | CreateLinkCommand
  | EditLinkCommand
  | StateCommand
  | PermanentlyDeleteCommand
  | ReleaseAliasCommand;

export type ReservedAlias = Readonly<{
  alias: Alias;
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
      kind: "released";
      alias: Alias;
    }>
  | Readonly<{
      ok: true;
      kind: "deleted";
      reservedAlias: ReservedAlias;
    }>
  | Readonly<{
      ok: false;
      kind: "alias-in-use" | "alias-reserved";
      alias: Alias;
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
      reason: "malformed" | "unsupported-protocol" | "credentials" | "redirect-loop" | "too-long";
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
      alias: Alias;
    }>
  | Readonly<{
      ok: false;
      kind: "alias-generation-exhausted";
    }>
  | Readonly<{
      ok: false;
      kind: "link-conflict";
      currentRevision: number;
    }>
  | Readonly<{
      ok: false;
      kind: "confirmation-mismatch";
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
      kind: "destination-versions";
      linkId: string;
      limit?: number;
      cursor?: string;
    }>
  | Readonly<{
      kind: "reserved-aliases";
      search?: string;
      limit?: number;
      cursor?: string;
    }>
  | Readonly<{
      kind: "list";
      search?: string;
      states?: readonly LinkState[];
      limit?: number;
      cursor?: string;
    }>;

export type LinkPage = Readonly<{
  items: readonly LinkSummary[];
  nextCursor: string | null;
}>;

export type DestinationVersionPage = Readonly<{
  items: readonly DestinationVersion[];
  nextCursor: string | null;
  currentVersionNumber: number;
}>;

export type ReservedAliasPage = Readonly<{
  items: readonly ReservedAlias[];
  nextCursor: string | null;
}>;

export type LinkQueryResult =
  | Readonly<{ ok: true; kind: "detail"; link: Link }>
  | Readonly<{ ok: true; kind: "page"; page: LinkPage }>
  | Readonly<{
      ok: true;
      kind: "destination-version-page";
      page: DestinationVersionPage;
    }>
  | Readonly<{
      ok: true;
      kind: "reserved-alias-page";
      page: ReservedAliasPage;
    }>
  | Readonly<{ ok: false; kind: "invalid-cursor" }>
  | Readonly<{
      ok: false;
      kind: "link-not-found";
      linkId: string;
    }>;

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

export type LinksPersistence = {
  create(
    link: Link,
    context: LinkMutationContext,
  ): Promise<"created" | "alias-in-use" | "alias-reserved">;
  findByAlias(alias: Alias): Promise<Link | null>;
  findById(id: string): Promise<Link | null>;
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

export type Links = {
  execute(command: LinkCommand, actor: Actor): Promise<LinkResult>;
  query(query: LinkQuery, actor: Actor): Promise<LinkQueryResult>;
  resolve(alias: string, incomingQuery?: string): Promise<RedirectDecision>;
};

export type CreateLinksOptions = Readonly<{
  persistence: LinksPersistence;
  redirectDomain: string;
  generateId?: () => string;
  generateAlias?: () => string;
  now?: () => Date;
}>;
