---
status: accepted
---

# Gate releases with an ephemeral Cloudflare deployment

Every pull request verifies the pure reconciliation planner with injected
failures, fake and contract-tested Cloudflare adapters, local D1 export/import
and migration paths, CLI JSON and exit-code contracts, and the hashes and
contents of an `npm pack` tarball. These deterministic tests run with the full
repository `pnpm check` and do not provision remote resources.

Before publication, the exact candidate tarball runs against a dedicated
Cloudflare account and test zone. The gate proves fresh installation, no-op
rerun, upgrade from the preceding release, interrupted-stage resumption,
Management-before-Redirect activation, Custom Domain TLS, Queue and dead-letter
configuration, and secret preservation. Cleanup detaches the Queue consumer
before removing Workers, Queues, D1, and domains and then verifies absence.
Cleanup failure blocks release and does not trigger a broader deletion retry.

Remote tests on every pull request were rejected because fixed account-wide
resource names force serialization and platform provisioning is slower and
less deterministic. Local-only release validation was rejected because it
cannot prove Cloudflare's real resource, deployment, and recovery constraints.
