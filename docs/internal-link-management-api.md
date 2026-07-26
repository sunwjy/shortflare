# Internal Link Management API

This document specifies the MVP same-origin Management API for Links,
Destination Version history, and Reserved Aliases. It does not specify the
React UI or the future public `/api/v1/*` API.

## Authorization and request integrity

- Viewer, Member, and Administrator may list and read Links and Destination
  Version history.
- Member and Administrator may create, edit, activate, disable, archive, and
  restore Links.
- Only Administrator may list Reserved Aliases, permanently delete Links, and
  release Reserved Aliases.
- Every endpoint requires an Active User Session.
- Mutations require an exact Management Origin, `application/json`, and the
  Session CSRF token.
- Permanent deletion and Alias release additionally require authentication
  within the previous ten minutes and an exact, case-sensitive Alias
  confirmation.
- API responses use `Cache-Control: no-store`.

## DTOs

```ts
type LinkDto = {
  id: string;
  alias: string;
  shortUrl: string;
  title: string;
  state: "active" | "disabled" | "archived";
  revision: number;
  destination: {
    id: string;
    versionNumber: number;
    url: string;
    createdAt: string;
  };
  createdAt: string;
  updatedAt: string;
};

type DestinationVersionDto = {
  id: string;
  versionNumber: number;
  url: string;
  createdAt: string;
  current: boolean;
};

type ReservedAliasDto = {
  alias: string;
  shortUrl: string;
  deletedLinkId: string;
  reservedAt: string;
};
```

Every timestamp is a UTC ISO 8601 string. The Management Worker derives each
`shortUrl` from the current HTTPS Redirect domain.

## Collections

Every collection returns:

```ts
type Page<Item> = {
  ok: true;
  items: readonly Item[];
  nextCursor: string | null;
};
```

There is no `total` or `hasMore`. Cursors are opaque, versioned, and bound to
the query that produced them. The default page size is 50 and the accepted
range is 1 through 100.

### List Links

```text
GET /api/internal/links
```

Accepted query parameters:

- one optional `search`, trimmed and limited to 200 Unicode code points;
- zero or more `state` values from `active`, `disabled`, and `archived`;
- one optional `limit`;
- one optional `cursor`.

With no `state`, Active and Disabled Links are returned. Search performs a
Unicode-normalized, case-folded substring match across Alias and title without
changing case-sensitive Alias identity. Results use
`createdAt DESC, id ASC`.

### List Destination Versions

```text
GET /api/internal/links/:linkId/destination-versions
```

Only `limit` and `cursor` are accepted. Results use
`versionNumber DESC`. Archived Link history remains readable. The collection is
read-only: reusing an old URL through Link edit appends a new Destination
Version.

### List Reserved Aliases

```text
GET /api/internal/reserved-aliases
```

Only `search`, `limit`, and `cursor` are accepted. Search performs the
management case-folded substring match on Alias. Results use
`reservedAt DESC, alias ASC`.

Unknown query parameters, repeated single-value parameters, invalid numbers,
and mismatched cursors return `400 invalid-query` or `400 invalid-cursor`.

## Link operations

### Create

```text
POST /api/internal/links
```

```ts
type CreateLinkRequest = {
  alias?: string;
  title: string;
  destination: string;
};
```

Omitting `alias` requests a generated six-character Base62 Alias. `null`, an
empty Alias, and unknown fields are invalid. A successful response is
`201 { ok: true, link: LinkDto }`.

### Detail

```text
GET /api/internal/links/:linkId
```

A successful response is `200 { ok: true, link: LinkDto }`. The Link DTO
contains only the current Destination; complete history uses its child
collection.

### Atomic edit

```text
PATCH /api/internal/links/:linkId
```

```ts
type EditLinkRequest = {
  expectedRevision: number;
  title?: string;
  destination?: string;
};
```

At least one editable field is required. Omission preserves a field; `null`,
Alias changes, and unknown fields are invalid. Both values validate before one
atomic persistence operation. A changed Destination appends a Destination
Version. A successful response is
`200 { ok: true, changed: boolean, link: LinkDto }`.

### State commands

```text
POST /api/internal/links/:linkId/activate
POST /api/internal/links/:linkId/disable
POST /api/internal/links/:linkId/archive
POST /api/internal/links/:linkId/restore
```

Each body is `{ expectedRevision: number }`. A successful response is
`200 { ok: true, changed: boolean, link: LinkDto }`.

### Permanent deletion

```text
POST /api/internal/links/:linkId/permanently-delete
```

The body is
`{ expectedRevision: number, confirmationAlias: string }`. The Link must be
Archived. A successful response is
`200 { ok: true, reservedAlias: ReservedAliasDto }`.

### Release a Reserved Alias

```text
POST /api/internal/reserved-aliases/:alias/release
```

The body is `{ confirmationAlias: string }`. A successful response is `204`
with no body.

## Concurrency, no-ops, and retries

Every mutation targeting an existing Link requires `expectedRevision`.
Revision validation precedes no-op detection. A stale request returns
`409 link-conflict` with only the current revision even if the desired state
already matches. A no-op at the current revision does not increment revision or
create an Audit Event.

The internal API does not store idempotency keys, and clients must not
automatically retry mutations. After an ambiguous transport failure, a client
refetches the relevant resource or collection before offering another command.

## Audit behavior

One successful atomic edit creates at most one Audit Event. Its metadata lists
only the fields that changed and the new Destination Version ID when
applicable. It never stores Link titles or Destination URLs. Failed, rejected,
and no-op commands create no Audit Event.

## Error contract

JSON successes use `ok: true`; JSON failures use:

```ts
type ApiError = {
  ok: false;
  kind: string;
  details: Record<string, unknown>;
};
```

- `400`: invalid request/query, invalid Alias/title/Destination, confirmation
  mismatch, or invalid cursor;
- `401`: missing or invalid Session, or non-Active User;
- `403`: insufficient capability, invalid CSRF/Origin, or required
  reauthentication;
- `404`: missing Link or Reserved Alias;
- `409`: Alias collision/reservation, stale revision, or invalid state;
- `500`: unexpected failure without internal validation or storage details.

Stable `kind` values drive client behavior. Human-facing messages belong to the
UI.
