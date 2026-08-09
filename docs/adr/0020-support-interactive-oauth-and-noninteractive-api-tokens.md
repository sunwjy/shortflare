---
status: accepted
---

# Support interactive OAuth and non-interactive API tokens

The deployment CLI supports both interactive Wrangler OAuth and non-interactive
Cloudflare API Token authentication. In an interactive terminal it reuses a
valid Wrangler session or starts Wrangler's login flow, obtains credentials only
for the running process, and requires the Owner to choose when more than one
Cloudflare account is available. Local Instance configuration may retain the
selected account ID but never credentials.

In a non-interactive environment, deployment requires a Cloudflare API Token and
an explicit account ID before planning any mutation. Tokens are never copied to
local configuration, D1, Deployment Attempts, or logs. Global API Key
authentication is not supported.

OAuth-only operation was rejected because it excludes CI and automation.
Token-only operation was rejected because requiring Owners to create and manage
a token would undermine the one-command interactive installation experience.
