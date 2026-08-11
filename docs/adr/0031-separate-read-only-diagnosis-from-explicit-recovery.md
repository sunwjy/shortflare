---
status: accepted
---

# Separate read-only diagnosis from explicit recovery

The MVP CLI exposes three operational boundaries. `deploy` performs safe
creation, update, and forward resumption of the same Deployment Attempt.
`diagnose` is read-only and reports the Deployment Marker, releases and schema,
Worker versions and bindings, Queue and dead-letter queue, domains, required
secret names, pending migrations, and failed attempts in human-readable or JSON
form. `recover` executes only a named action identified by diagnosis through a
separately approved Deployment Plan.

Recovery actions include Orphan Resource removal, unavailable Setup Token
rotation, analytics secret restoration or explicit rotation, and a verified
Worker rollback. Routine deployment does not infer or repair ambiguous drift.
Uninstall is outside Roadmap 10.

Automatic recovery inside `deploy` was rejected because diagnosis cannot grant
authority for destructive or identity-changing work. Printing only manual
Cloudflare steps was rejected because the CLI already has the ownership model
and ordering needed to make approved recovery repeatable and testable.
