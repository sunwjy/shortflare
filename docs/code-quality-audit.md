# Code Quality Audit

Date: 2026-07-30

Status: completed

This audit covers the production and test TypeScript/TSX in `apps/` and
`packages/`. The findings recorded on 2026-07-29 have been addressed. This is
not a claim that static inspection can prove the absence of every defect.

## Completed improvements

### Repository checks

- Added the repository-wide code quality contract to `AGENTS.md`.
- Added type-aware deprecated API detection to `pnpm check`.
- Kept unused lint-directive reporting enabled and removed obsolete local
  exceptions.
- Replaced the deprecated root lookup without weakening the remaining React
  lint rules.

### Links and database boundaries

- Moved persistence-only Links contracts behind the
  `@shortflare/links/persistence` subpath. Transport callers now depend only on
  the `Links` application interface.
- Split the database schema into Identity, Links, audit, and constraint modules
  while retaining the stable public schema export used by migrations.
- Kept `LinksPersistence` as the D1 adapter boundary and moved record
  hydration, keyset pagination, and persistence operations into internal
  modules.

### Identity

- Reduced `worker/identity.ts` to a composition root.
- Split setup, Sessions, Invitations, Users, Password Resets, and operator
  recovery into capability-owned application modules.
- Added D1 adapters and in-memory interface adapters for each capability.
- Kept transaction-sensitive behavior inside the D1 adapters and added
  interface-level regression tests for both persistence implementations.

### Management transport

- Reduced `worker/index.ts` to application composition.
- Split authentication, User, Link, and Reserved Alias HTTP routes by
  capability.
- Reused the shared HTTP authentication policy across route modules.
- Added exhaustive capability-local result-to-HTTP mappers so new result kinds
  cannot silently fall through.

### Management client

- Reduced `management-app.tsx` to provider composition.
- Extracted route configuration and the application shell.
- Split Links, Users, and Security into capability-owned feature modules; Link
  list, creation, detail, sensitive actions, row presentation, and route search
  each have focused ownership.
- Kept React Query keys, queries, mutations, and their effects inside the
  owning feature.
- Split the former global stylesheet into named cascade layers for base, shell,
  Links, settings, dialogs, authentication, and responsive behavior.
- Replaced caller-selected JSON casts with strict runtime response schemas.
- Separated JSON requests from no-content requests and normalized malformed
  proxy or server responses into `ApiProtocolError`.

### Test structure and type safety

- Split the Links contract suite into lifecycle, management, Destination
  Version, and pagination/reservation behavior modules while preserving the
  `linksContract` entrypoint.
- Split Identity D1 integration tests by capability.
- Split Management Worker integration tests by route capability and shared
  their database and authentication fixtures.
- Replaced sequential `no-await-in-loop` exceptions with one shared
  promise-chained fixture builder.
- Replaced the Redirect Worker test's fabricated `D1Database` double cast with
  a typed failure adapter around the Worker-pool binding.

## Deferred-by-design package guardrail

`packages/analytics` and `packages/deploy` still contain package-identity
placeholders and no application behavior. Their first real behavior must
introduce a small application interface and put effects behind adapters; it
must not accumulate implementation in `index.ts`. Creating speculative
interfaces before a real use case would violate the repository's rule against
pass-through seams.

## Verification

The completed audit passes the repository pipeline:

```text
pnpm check
```

That pipeline runs linting, deprecated API detection, formatting checks,
typechecks, all tests, and all builds.

## Ongoing audit checks

- Keep `oxlint --report-unused-disable-directives` in review workflows.
- Keep deprecated API detection in `pnpm check`; static text search is
  insufficient for overloaded APIs.
- Treat 400 production lines as a review trigger, not an automatic split.
- Re-run this audit when Analytics or Deploy receives its first real behavior,
  or when a capability begins mixing application policy, transport, and
  persistence again.
