# Code Quality Audit

Date: 2026-07-29

This audit covers the production and test TypeScript/TSX in `apps/` and
`packages/`. It is a living backlog, not a claim that static inspection can
prove the absence of every defect.

## Completed in this pass

- Added the repository-wide code quality contract to `AGENTS.md`.
- Added a type-aware deprecated API check to the root `check` pipeline.
- Replaced the root lookup with `getElementById`, avoiding the deprecation noise
  produced when tools merge `querySelector`'s current and legacy overload tags.
- Removed the broad React performance lint directives from both application
  screen files. The two rules that flag every locally declared JSX callback or
  object are now configured off once; forcing `useCallback` around ordinary
  intrinsic-element handlers would add dependency-array risk without providing
  a memoized consumer. The rest of the React performance rules remain enabled.
- Removed production `no-await-in-loop` directives. Alias collision attempts and
  optimistic-concurrency retries now express required sequencing directly.
- Extracted Management Worker bindings, strict request schemas, authentication
  policy, query parsing, and DTO mapping from the route composition module.

## Highest-priority remaining work

### 1. Identity mixes application policy and D1 persistence

`apps/management/src/worker/identity.ts` is 1,227 lines. It combines credential
flows, Session policy, Invitation policy, User lifecycle policy, token hashing,
row mapping, and raw D1 statements behind one factory. The public interface is
useful, but the implementation has poor locality and its domain decisions cannot
be tested without a D1 adapter.

Deepen it as an Identity module whose small application interface owns the
flows, with an internal persistence seam implemented by D1 and an in-memory test
adapter. Split by cohesive capability (`sessions`, `invitations`,
`password-resets`, `operator-recovery`, `users`) only behind that interface.
Keep transaction-sensitive operations in the D1 adapter.

### 2. Management routes remain one transport module

`apps/management/src/worker/index.ts` fell from 1,024 to roughly 700 lines but
still registers authentication, User, Link, and Reserved Alias routes together.
Make the file a composition root that installs capability-focused Hono modules.
Share authentication through the existing HTTP policy module; do not duplicate
its response translation in each route module.

The repeated `if (result.kind === ...)` chains also use untyped string errors.
Introduce exhaustive, capability-local result-to-HTTP mappers so a new domain
result cannot silently fall through or disagree with its status code.

### 3. The management client is a 1,500-line screen collection

`apps/management/src/client/management-app.tsx` owns router construction,
application shell, four pages, Link creation/detail workflows, destructive
dialogs, query definitions, mutation effects, and presentation helpers.
`styles.css` is nearly 1,000 lines with the same cross-feature coupling.

Extract route configuration, shell/navigation, and the `links`, `users`, and
`security` feature modules. Keep query keys and mutations inside their owning
feature. Move feature styles with the feature or establish named CSS layers.
Avoid creating a generic components bucket for one-use fragments.

### 4. The client HTTP interface trusts arbitrary JSON

`apps/management/src/client/api.ts` casts response JSON to a caller-selected
generic, casts `204` to any response type, and assumes every error has a valid
JSON envelope. A proxy HTML error or a drifted DTO therefore becomes a misleading
runtime shape or a raw `SyntaxError`.

Give each feature a runtime response schema, validate the common envelope, and
model JSON and no-content requests as distinct interfaces. This is the client
counterpart of the Worker's strict request schemas.

## Structural follow-ups

- `packages/database/src/adapters/d1-links-persistence.ts` is about 800 lines.
  Its seam is real, but query construction, hydration, mutations, and keyset
  pagination should become internal modules behind the existing
  `LinksPersistence` interface.
- `packages/database/src/schema/index.ts` is over 400 lines. Group schema tables
  by capability while retaining one public schema export for migrations.
- `packages/links/src/types.ts` exposes a large persistence interface beside
  domain commands and results. Move persistence-only contracts to a clearly
  internal seam so transport callers learn only `Links`.
- `packages/links/test/contract.ts`, `apps/management/test/worker.test.ts`, and
  `apps/management/test/identity.test.ts` are monolithic suites. Split them by
  behavior while continuing to test through the same public interface.
- Sequential test setup still carries several narrow `no-await-in-loop`
  directives. Replace repeated cases with a shared sequential fixture builder,
  leaving at most one explained suppression if recursion would obscure the
  scenario.
- `apps/redirect-worker/test/index.test.ts` uses a double cast to fabricate a
  `D1Database`. Replace it with a typed adapter or Worker-pool binding.
- `packages/analytics` and `packages/deploy` are placeholder modules. Do not
  grow their future implementation in `index.ts`; define their application
  interface and adapters when the first real behavior lands.

## Ongoing audit checks

- Keep `oxlint --report-unused-disable-directives` in review workflows so
  obsolete exceptions are removed.
- Keep deprecated API detection in `pnpm check`; static text search is
  insufficient for overloaded APIs.
- Re-run this audit after the Identity and client extractions. Line count is only
  a trigger: accept a large file only when its single deep implementation has
  better locality than the available seams.
