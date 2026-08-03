# Hono Management Backend Architecture

Date: 2026-08-03

## Question

How should the Management Worker be modularized using architecture patterns that
fit Hono, while considering functional design, DDD, MVC, and ports and adapters?

The repository currently pins Hono 4.12.31.

## Recommendation

Use a **capability-first modular monolith** with:

- Hono sub-apps as HTTP adapters, composed with `app.route()`;
- a functional application/domain core that accepts dependencies and returns
  discriminated results;
- D1, cookies, Hono `Context`, and transport DTOs kept in adapters;
- pragmatic DDD terminology and invariants, without class-heavy tactical DDD;
- explicit dependency factories at the composition root, without a DI container;
- a pure Management-local access-control module and an injected request-authentication port;
- interface-level tests for application modules and request-level tests for each
  Hono sub-app.

This is best described as **feature-sliced functional hexagonal architecture**.
It preserves Shortflare's existing domain contracts and matches Hono's own
guidance better than conventional controller-heavy MVC.

## Why this fits Hono

Hono does not prescribe an application architecture. Its official guidance says
larger applications should be split into sub-apps and mounted with `app.route()`.
It also advises against extracting Rails-style controllers because doing so
weakens route-parameter type inference; handlers should normally remain beside
route definitions. If separate handler arrays are genuinely useful,
`factory.createHandlers()` preserves typing. [Hono best practices]

`createFactory<Env>()` can centralize Hono environment typing and create apps,
middleware, and handler arrays. Its `initApp` option can install typed bindings or
variables, but this is a transport convenience rather than an application
architecture or a reason to introduce a DI container. [Hono factory]

Middleware and routes execute in registration order, with the post-`next()` path
unwinding in reverse. Security-sensitive ordering therefore remains visible and
must have request-level regression tests. [Hono middleware] [Hono routing]

## Current assessment

What is already sound:

- `worker/index.ts` is a small composition point and already uses `app.route()`.
- Link policy lives in `@shortflare/links`, outside Hono and D1.
- Identity behavior is implemented with functional factories and result values.
- D1 and in-memory identity adapters already provide real persistence seams.
- Worker tests exercise the deployed HTTP interface, while identity tests use
  module interfaces.

The weak spots are responsibility placement rather than the absence of layers:

- `routes/links.ts` combines route registration, authentication, request parsing,
  application construction, D1 adapter construction, DTO presentation, and
  domain-result-to-HTTP mapping in one 301-line file.
- `http.ts` combines Link query parsing, Link presentation, cookies, Origin and
  content-type enforcement, authentication, authorization, and identity
  construction in one 296-line cross-capability module.
- `createIdentity({ db })` and Link/D1 construction happen below the composition
  root, so transport code chooses production implementations and is harder to
  test with focused substitutes.
- `request-schemas.ts` groups schemas by technical type instead of capability.
- `auth` and `users` are one Identity capability but are separated primarily by
  URL shape, while their application and adapter files live elsewhere.

## Pattern comparison

| Pattern | Fit | Use | Avoid |
| --- | --- | --- | --- |
| Functional core / imperative shell | Excellent | Pure validation and policy functions, closures for application modules, discriminated results, explicit dependency arguments | Building dependencies inside handlers |
| Ports and adapters / clean architecture | Excellent | Hono and D1 as outer adapters; interfaces owned by the application module; inward dependencies | A port for every function or a repository wrapper with only one implementation and no test substitute |
| Pragmatic DDD | Strong | Capability names, domain invariants, Actor, Link, Alias, User, Session, Audit Event, and module-level transaction guarantees | Entities/services/repositories as mandatory classes; duplicating the existing glossary into boilerplate types |
| Vertical slices / feature-first modules | Excellent | Keep routes, schemas, presenters, and error mapping local to Links or Identity | Global `controllers/`, `services/`, `repositories/`, and `schemas/` folders |
| MVC | Weak as the top-level architecture | JSON presenters can play the View role; inline Hono handlers can play a thin Controller role | Extracted controller classes or one controller method per route; Hono explicitly discourages Rails-like controllers when possible |
| DI container | Unnecessary now | Reconsider only if request-scoped dependency graphs become dynamic and demonstrably complex | Hidden service lookup through a generic container or broad `c.var.services` object |

## Target shape

The exact filenames can change during design, but dependencies should have this
direction:

```text
worker/
├── index.ts                         # export the production app only
├── app.ts                           # createManagementApp(dependencies)
├── access-control/                  # pure role-to-capability policy
├── transport/
│   ├── factory.ts                   # typed Hono factory
│   ├── error-handler.ts             # unexpected transport failures
│   ├── security-headers.ts          # global response policy
│   ├── request-authentication.ts     # injected authentication port
│   └── authentication.ts            # purpose-named HTTP auth middleware
└── modules/
    ├── links/
    │   └── http/
    │       ├── routes.ts             # chainable Hono sub-app
    │       ├── link-routes.ts        # Link and Destination Version routes
    │       ├── reserved-alias-routes.ts
    │       ├── schemas.ts
    │       ├── queries.ts
    │       ├── presenter.ts
    │       └── errors.ts
    └── identity/
        ├── index.ts                 # facet interface and composition
        ├── application/             # functional policy facets
        ├── adapters/d1/             # Identity D1 adapters
        └── http/
            ├── auth-routes.ts
            ├── user-routes.ts
            ├── schemas.ts
            └── presenter.ts
```

`@shortflare/links` and `@shortflare/database` should remain separate. The
Management Links module is only the HTTP adapter around those existing modules;
it should not duplicate Link policy.

The production composition root should supply narrow, purpose-named dependency
factories such as `createIdentity(bindings)` and `createLinks(bindings)`. Route
modules may resolve them for the current request, but must not import D1 adapter
constructors. Tests can then provide in-memory implementations through the same
interface. Prefer this explicit object over a general-purpose DI container.

Identity remains one Management-local module whose interface groups Initial
Setup, Sessions, Invitations, Users, Password Resets, and Operator Recovery into
named facets. Shared transport owns the narrower request-authentication port it
needs; the composition root adapts the Sessions facet to that port so Links HTTP
never imports Identity directly.

## Hono-specific rules

1. Keep handlers inline with their route declaration unless extraction removes
   meaningful complexity. Use `factory.createHandlers()` only when a reusable
   handler chain earns its interface.
2. Build each capability as a chainable sub-app and mount it with `app.route()`.
   Register all child routes before mounting them because Hono copies the routes
   present at mount time. [Hono routing]
3. Use route middleware for shared transport policy: request integrity,
   authentication, authorization, and recent-authentication checks. Keep policy
   order explicit; do not collapse these into a Boolean flag.
4. Store only a narrow authenticated Actor/session value in typed Hono Variables.
   Do not expose a generic container through `c.var`.
5. Keep Zod schemas and strict query parsing with their capability. Validation is
   an HTTP adapter concern; domain validation remains in the application module.
6. Keep `app.onError()` for unexpected failures. Expected domain results should
   continue to be mapped exhaustively by each capability adapter.
7. Preserve request-level tests with `app.request()` for middleware ordering,
   cookies, status/body agreement, and error mapping. [Hono testing]
8. For authenticated mutations, apply request integrity, Session and CSRF,
   Capability, validation, and recent-authentication checks in that order. The
   same order defines the response precedence when failures overlap.

## Migration order

1. Introduce `createManagementApp(dependencies)` without changing behavior.
2. Introduce access control, the request-authentication port, and shared
   transport middleware; fix the agreed overlapping-failure precedence with
   request-level tests.
3. Move Link schemas, strict query parsing, presenters, and expected error
   mapping beside Link routes. Keep current worker tests green.
4. Regroup Identity behind named facets and move its HTTP and D1 adapters without
   changing application behavior.
5. Remove the old cross-capability HTTP and schema files.
6. Reassess the remaining interfaces using the deletion test: if removing a new
   module merely pastes the same code into one caller, merge it back.

No full rewrite is warranted. The current `app.route()` shell and functional
domain modules are the foundation; the work is to move composition outward and
restore capability locality.

## Sources

- [Hono best practices](https://hono.dev/docs/guides/best-practices)
- [Hono factory helper](https://hono.dev/docs/helpers/factory)
- [Hono middleware guide](https://hono.dev/docs/guides/middleware)
- [Hono validation guide](https://hono.dev/docs/guides/validation)
- [Hono routing API](https://hono.dev/docs/api/routing)
- [Hono testing guide](https://hono.dev/docs/guides/testing)
- [Hono grouping routes for RPC example](https://hono.dev/examples/grouping-routes-rpc)

[Hono best practices]: https://hono.dev/docs/guides/best-practices
[Hono factory]: https://hono.dev/docs/helpers/factory
[Hono middleware]: https://hono.dev/docs/guides/middleware
[Hono routing]: https://hono.dev/docs/api/routing
[Hono testing]: https://hono.dev/docs/guides/testing
