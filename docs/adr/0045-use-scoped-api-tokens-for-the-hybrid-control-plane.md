---
status: accepted
---

# Use scoped API Tokens for the hybrid control plane

The deployment CLI requires a scoped Cloudflare API Token and explicit account
ID in both interactive and non-interactive operation. The token is restricted
to the target account and selected zones, remains process-only, and is passed to
the typed REST adapter and bundled Wrangler process through their documented
authentication environment. Global API Keys are not supported.

Wrangler's encrypted OAuth profile has no supported credential-broker API for a
separate Node.js REST client. Importing Wrangler internals or scraping its local
credential store would couple Shortflare to private implementation details and
weaken the credential boundary. ADR-0020 is therefore superseded until
Cloudflare exposes a documented broker suitable for the hybrid adapter.

Token-only authentication adds an Owner setup step, but preserves typed
discovery, least-privilege planning, secret-name-only observation, and identical
CI behavior. The CLI reports the exact required permissions before mutation.
