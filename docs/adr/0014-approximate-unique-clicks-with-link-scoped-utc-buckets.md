---
status: accepted
---

# Approximate unique clicks with Link-scoped UTC buckets

Derive each Pseudonymous Visitor with HMAC-SHA-256 from a long-lived Instance
secret, the Link ID, a fixed UTC half-hour bucket, and transient client IP and
User-Agent values. The raw inputs are never retained, and the Link scope
prevents correlation across Links. This deliberately accepts NAT collisions,
User-Agent instability, and double counting across bucket boundaries in
exchange for stateless ingestion without a persistent visitor identifier.

## Consequences

Hourly and Daily Unique Human Clicks sum fixed half-hour counts rather than
representing distinct people over those longer periods. Instance-wide Unique
Human Clicks sum Link-level counts, Destination Version counts are not additive
to their Link total, and secret rotation can create additional counts in the
active bucket. Exact rolling windows, daily unique visitors, cross-Link paths,
cookies, and retroactive pseudonym recomputation are outside the MVP.
