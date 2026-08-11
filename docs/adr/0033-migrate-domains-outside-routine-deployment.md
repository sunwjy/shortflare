---
status: accepted
---

# Migrate domains outside routine deployment

Routine `deploy` preserves an existing Redirect Domain and Management Domain.
Supplying a different hostname for an existing Instance stops deployment and
directs the Owner to an explicit `recover domain` workflow rather than changing
traffic as part of a release upgrade.

A Redirect Domain migration verifies the new hostname under ADR-0022, attaches
it to the existing Redirect Worker, and validates the root and an existing
Active Link before recording it as primary. The previous hostname remains
attached so existing short URLs continue to work; removing it requires a later
destructive Deployment Plan and separate approval. Management Domain migration
uses the same ownership and overlap rules without the Link check.

Immediate replacement was rejected because every existing short URL depends on
the Redirect Domain. Permanent immutability was rejected because an Owner must
be able to recover from a lost or transferred domain without rebuilding the
Instance.
