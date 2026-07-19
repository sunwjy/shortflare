---
status: accepted
---

# Use durable analytics by default

The MVP sends click events through Queue to deletable D1 raw storage and durable
rollups. This accepts D1's eventual write-throughput ceiling in exchange for
exact recomputation, 90-day application-controlled retention, individual
deletion, export, recovery, and production-like local development for the
personal and small-team default.

## Consequences

Analytics owns a storage-neutral interface and D1 rollup schema so a later
high-scale adapter can ingest through Analytics Engine and persist periodic
rollups without changing callers. That mode will be explicit because Analytics
Engine introduces sampling, fixed raw retention, an additional account token,
and weaker individual deletion guarantees; the MVP does not continuously
double-write to both stores.
