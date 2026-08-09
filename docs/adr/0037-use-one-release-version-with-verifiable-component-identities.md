---
status: accepted
---

# Use one Release version with verifiable component identities

Owners select and reason about one SemVer Shortflare Release matching the npm
package version. Internally, each Release manifest also identifies a monotonic
schema version and migration journal digest, plus the SHA-256 digest of each
Management and Redirect Worker artifact.

A Coherent Release records the user-facing Release SemVer, manifest digest,
schema identity, both artifact digests, and the corresponding live Cloudflare
Worker version IDs. Routine output leads with the Release SemVer, while
`diagnose --json` exposes every component identity for precise drift and partial
deployment analysis.

Recording only SemVer was rejected because it cannot distinguish a partially
activated or out-of-band Worker version. Exposing independently selectable
schema and Worker versions was rejected because Shortflare does not support
arbitrary component combinations and the Owner should not have to construct
one.
