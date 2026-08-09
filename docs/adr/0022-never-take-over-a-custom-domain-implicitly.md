---
status: accepted
---

# Never take over a Custom Domain implicitly

The deployment CLI configures only exact Redirect and Management hostnames in a
zone managed by the selected Cloudflare account. The MVP does not support
wildcards or path-based Worker Routes. An unused hostname may become a Worker
Custom Domain with Cloudflare-managed DNS and TLS, and a hostname already bound
to the same verified Instance is reconciled idempotently.

If the hostname has an existing DNS origin, Worker, Pages project, route, or
other incompatible attachment, preflight stops without replacing or adopting
it and identifies the collision. The MVP provides no force-takeover option; the
Owner must resolve the conflict explicitly in Cloudflare before rerunning.

Confirmation-based replacement was rejected because a hostname controls all of
its traffic and an apparently compatible record does not prove Shortflare
ownership. Name-based adoption was rejected for the same reason as resource
adoption: only verified Instance identity grants mutation authority.
