declare const aliasBrand: unique symbol;

export type Alias = string & { readonly [aliasBrand]: true };

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
  alias: Alias;
  title: string;
  state: LinkState;
  destinationVersions: readonly DestinationVersion[];
  createdAt: Date;
  updatedAt: Date;
}>;

export type CreateLinkCommand = Readonly<{
  kind: "create";
  alias?: string;
  title: string;
  destination: string;
}>;

export type UpdateDestinationCommand = Readonly<{
  kind: "update-destination";
  linkId: string;
  destination: string;
}>;

export type UpdateTitleCommand = Readonly<{
  kind: "update-title";
  linkId: string;
  title: string;
}>;

export type StateCommandKind = "activate" | "disable" | "archive" | "restore";
export type StateCommand = {
  [Kind in StateCommandKind]: Readonly<{
    kind: Kind;
    linkId: string;
  }>;
}[StateCommandKind];

export type PermanentlyDeleteCommand = Readonly<{
  kind: "permanently-delete";
  linkId: string;
}>;

export type ReleaseAliasCommand = Readonly<{
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
      kind: "deleted" | "released";
      alias: Alias;
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
      alias: Alias;
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

export type PersistenceListQuery = Readonly<{
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

export type PersistedLinkMutation =
  | Readonly<{ kind: "updated"; changed: boolean; link: Link }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "invalid-state"; state: LinkState }>;

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
    target: LinkState,
    allowedCurrentStates: readonly LinkState[],
    context: LinkMutationContext,
  ): Promise<PersistedLinkMutation>;
  updateTitle(
    linkId: string,
    title: string,
    context: LinkMutationContext,
  ): Promise<PersistedLinkMutation>;
  appendDestinationVersion(
    linkId: string,
    destinationVersion: DestinationVersion,
    context: LinkMutationContext,
  ): Promise<PersistedLinkMutation>;
  permanentlyDelete(
    linkId: string,
    context: LinkMutationContext,
  ): Promise<
    | Readonly<{ kind: "deleted"; alias: Alias }>
    | Readonly<{ kind: "not-found" }>
    | Readonly<{ kind: "invalid-state"; state: LinkState }>
  >;
  releaseReservedAlias(
    alias: Alias,
    context: LinkMutationContext,
  ): Promise<"released" | "not-found">;
  list(query: PersistenceListQuery): Promise<LinkPage>;
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
