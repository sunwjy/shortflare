---
status: accepted
---

# Plan and apply within one deploy command

`shortflare deploy` first observes the selected account and Instance and creates
an immutable Deployment Plan containing the source and target releases,
migrations, and ordered resource actions. Interactive operation renders the
plan and applies that same plan after confirmation. `--dry-run` renders the plan
and its digest without mutation; non-interactive operation accepts a
non-destructive plan through `--yes`.

A destructive plan requires prior approval tied to its exact digest. Account
and Instance identity, target release, observed resource versions, and actions
contribute to the digest; credentials and secret values never do. Before each
effect, reconciliation verifies the relevant preconditions. Drift invalidates
the plan rather than allowing stale actions to continue.

Immediate procedural execution was rejected because the Owner could not review
or reproduce the intended changes. Mandatory separate plan and apply commands
were rejected because routine safe installation and upgrade should retain the
one-command experience.
