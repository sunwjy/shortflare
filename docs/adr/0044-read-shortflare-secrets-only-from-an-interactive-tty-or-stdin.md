---
status: accepted
---

# Read Shortflare secrets only from an interactive TTY or stdin

Interactive recovery reads a Shortflare secret through a non-echoing TTY prompt.
Non-interactive initial setup requires `--setup-token-stdin`, and analytics key
restoration reads exactly one secret from stdin through its named recovery
action. The CLI exposes no Shortflare business secret as an argument or
environment-variable interface.

Cloudflare authentication continues to use Wrangler's standard environment
variables. Child Wrangler processes receive only the required Cloudflare
environment and never inherit a Shortflare secret or the parent's stdin. Plans,
digests, JSON, logs, local configuration, and Deployment Attempts contain no
secret input.

Command-line secrets were rejected because process listings and shell history
can expose them. Shortflare-specific environment secrets were rejected because
the CLI invokes child tooling and would needlessly widen the secret's process
scope; stdin remains straightforward for CI secret injection.
