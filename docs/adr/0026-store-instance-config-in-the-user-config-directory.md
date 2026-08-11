---
status: accepted
---

# Store Instance config in the user config directory

The deployment CLI stores one non-secret JSON cache per Cloudflare account in
the platform-standard user configuration directory. It may contain the account
and Instance identifiers, resource identifiers and names, configured domains,
and last observed Coherent Release. Writes replace the file atomically with
user-only permissions. `--config <path>` supports an explicit automation or
operations location.

Local Instance configuration is never authoritative. If absent or stale,
Deployment Reconciliation discovers and verifies the Instance through its D1
Deployment Marker and live Cloudflare state before refreshing the cache. The
file never contains Cloudflare credentials, Worker Secrets, or one-time token
plaintext.

A repository-local default was rejected because `npx shortflare deploy` is not
tied to a checkout and the file could be committed accidentally. Omitting the
cache entirely was rejected because stable resource and domain hints improve
repeat execution without weakening marker-based ownership.
