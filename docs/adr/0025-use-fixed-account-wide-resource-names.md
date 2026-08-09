---
status: accepted
---

# Use fixed account-wide resource names

Because a Cloudflare account may contain only one Shortflare Instance, the MVP
uses fixed resource names: `shortflare` for D1, `shortflare-management` and
`shortflare-redirect` for the Workers, `shortflare-events` for the Queue, and
`shortflare-events-dlq` for its dead-letter queue.

These names are deterministic discovery hints, not ownership evidence.
Deployment Reconciliation verifies the D1 Deployment Marker and the managed
resource relationships before mutation. An unmarked same-named resource is a
collision and stops deployment under ADR-0016.

Random Instance suffixes were rejected because they make recovery without local
configuration ambiguous. Owner-defined prefixes were rejected because they
suggest unsupported multiple Instances per account and enlarge the installation
and support surface without an MVP use case.
