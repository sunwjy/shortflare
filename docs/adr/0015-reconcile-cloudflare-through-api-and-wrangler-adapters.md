---
status: accepted
---

# Reconcile Cloudflare through API and Wrangler adapters

The deployment CLI owns a desired-state reconciliation plan and observes the
actual Cloudflare account before each resumable step. A typed Cloudflare API
adapter handles resource discovery, reconciliation, custom domains, secrets,
and version validation, while a pinned Wrangler adapter handles Worker
deployment and D1 migrations. Keeping both behind a narrow control-plane
interface avoids coupling deployment policy to either tool and allows partial
failure and rerun behavior to be tested without Cloudflare.

Wrangler-only orchestration was rejected because the CLI must inspect and
reconcile account-wide state and settings that are not uniformly exposed as
stable structured command output. API-only orchestration was rejected because
it would duplicate the repository's established Wrangler artifact and migration
workflow.
