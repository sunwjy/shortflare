---
status: accepted
---

# Declare ownership and drift policy in release manifests

Each Shortflare Release manifest classifies managed state by ownership and drift
policy. Shortflare invariants such as D1 and Queue bindings and Queue retry,
dead-letter, concurrency, and retention settings are rendered in the Deployment
Plan and reconciled after approval. Supported Owner settings such as the
analytics cleanup schedule and selected Management Domain are preserved across
upgrades.

Unknown Worker code or versions, altered migration history, unexpected Queue
consumers, and Deployment Marker mismatches are critical Deployment Drift.
Routine deployment leaves them unchanged and requires diagnosis and an explicit
recovery action. Unexpected routes, DNS records, and unmarked resources are
foreign resources; they remain outside Instance ownership and stop only the
actions with which they conflict.

Overwriting all live values was rejected because it would erase supported Owner
choices and could take over foreign resources. Preserving all drift was rejected
because security, delivery, and retention invariants would silently decay.
