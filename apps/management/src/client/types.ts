export type Role = "administrator" | "member" | "viewer";
export type UserState = "invited" | "active" | "suspended";
export type LinkState = "active" | "disabled" | "archived";

export type User = Readonly<{
  id: string;
  email: string;
  role: Role;
  state: UserState;
}>;

export type Session = Readonly<{ user: User; csrfToken: string }>;

export type LinkDto = Readonly<{
  id: string;
  alias: string;
  shortUrl: string;
  title: string;
  state: LinkState;
  revision: number;
  destination: Readonly<{
    id: string;
    versionNumber: number;
    url: string;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}>;

export type Page<Item> = Readonly<{
  ok: true;
  items: readonly Item[];
  nextCursor: string | null;
}>;

export type DestinationVersionDto = Readonly<{
  id: string;
  versionNumber: number;
  url: string;
  createdAt: string;
  current: boolean;
}>;

export type ReservedAliasDto = Readonly<{
  alias: string;
  shortUrl: string;
  deletedLinkId: string;
  reservedAt: string;
}>;

export type TokenRoute = Readonly<{
  kind: "setup" | "invitation" | "reset" | "recovery";
  endpoint: string;
  token: string;
}>;
