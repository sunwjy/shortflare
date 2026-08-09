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
  | Readonly<{ kind: "summaries"; linkIds: readonly string[] }>
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
  | Readonly<{ ok: true; kind: "summaries"; items: readonly LinkSummary[] }>
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

export type Links = {
  execute(command: LinkCommand, actor: Actor): Promise<LinkResult>;
  query(query: LinkQuery, actor: Actor): Promise<LinkQueryResult>;
  resolve(alias: string, incomingQuery?: string): Promise<RedirectDecision>;
};
