---
status: accepted
---

# Organize the Management backend by capability

Structure the Management backend as a capability-first modular monolith with a
functional application core and Hono and D1 adapters. Hono sub-apps remain close
to their route declarations, while a single composition root injects narrow
module factories and authentication ports; this preserves Hono type inference
without letting transport or persistence concerns leak into application policy.

## Considered options

- A conventional MVC or `controllers/services/repositories` layout was rejected
  because one capability would be scattered across technical layers and Hono
  discourages extracted Rails-style controllers when inline routes can retain
  better type inference.
- A DI container was rejected because the current dependency graph is static and
  explicit factories provide the required production and test variation without
  hidden lookup.
- Separate Authentication and Users modules were rejected because User, Session,
  Invitation, Password Reset, and recovery behavior share lifecycle invariants;
  they remain facets of one Management-local Identity module.

## Consequences

`app.ts` is the only composition root. Links and Identity expose Hono sub-apps,
shared HTTP policy lives in a constrained transport module, and centralized role
policy lives in a pure access-control module. Request integrity, authentication,
authorization, validation, and recent-authentication checks have an explicit
order and request-level regression tests. `@shortflare/links` and
`@shortflare/database` remain workspace packages, while Identity stays local to
the Management Worker until a second runtime caller creates a real package seam.
