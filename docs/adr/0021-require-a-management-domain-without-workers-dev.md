---
status: accepted
---

# Require a Management domain without workers.dev

Deployment preflight detects whether the selected Cloudflare account already
has a registered `workers.dev` subdomain. When it does, Management uses its
`workers.dev` address and a Management custom domain remains optional. When it
does not, the Owner must provide a Management custom domain and the generated
Worker configuration disables `workers.dev`.

If neither address is available, the CLI stops before creating or changing any
resource and explains how to register the account subdomain in the Cloudflare
Dashboard or rerun with a Management domain. The CLI does not call undocumented
APIs to register or change this account-wide setting. Requiring Dashboard setup
unconditionally was rejected because an available custom domain can complete
the installation safely in one run.
