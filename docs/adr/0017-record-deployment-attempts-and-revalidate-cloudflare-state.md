---
status: accepted
---

# Record Deployment Attempts and revalidate Cloudflare state

The Instance D1 database stores each Deployment Attempt's target Shortflare
Release, progress, outcome, and the last verified Coherent Release. A successful
attempt records a new Coherent Release only after the schema, Management Worker,
Redirect Worker, bindings, and health checks are compatible and verified.

On every run, Deployment Reconciliation compares the durable record with live
Cloudflare resources, deployed Worker versions, bindings, and applied D1
migrations before choosing the next action. A checkpoint explains intent and
supports recovery but never overrides observed state. Local Instance
configuration remains a convenience cache rather than deployment authority.

Inferring progress only from Cloudflare was rejected because an interrupted
deployment would lose its target and decision history. Trusting D1 checkpoints
without revalidation was rejected because a crash before recording progress or
an out-of-band Cloudflare change could make them stale.
