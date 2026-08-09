# Deployment CLI

The published `shortflare` package contains the CLI, immutable Worker builds,
forward-only D1 migrations, and a SHA-256 release manifest. The command verifies
that bundle before observing or changing Cloudflare resources.

## Requirements

- Node.js 22.12 or newer.
- A Cloudflare account with a registered domain for the required Redirect
  Custom Domain.
- A scoped Cloudflare API Token in `CLOUDFLARE_API_TOKEN`.
- The target account ID in `CLOUDFLARE_ACCOUNT_ID` or `--account-id`.

Use a custom API Token restricted to the target account and the Redirect and
optional Management zones. It needs Account `Workers Scripts: Write`, `D1:
Edit`, and `Queues: Edit`, plus Zone `Workers Routes: Write` for the selected
zones. Do not use a Global API Key or a broader account token. Shortflare never
writes this token to its config, D1, logs, or Deployment Attempts.

> [!NOTE]
> Wrangler stores interactive OAuth credentials behind its own encrypted
> profile and does not expose a supported credential broker to another Node.js
> program. Shortflare therefore uses the documented API Token path for its
> typed REST reconciliation and passes the same standard Cloudflare environment
> only to the bundled Wrangler process. It never imports Wrangler internals.

## Install

Run the command and answer the domain, Administrator email, and exact-plan
approval prompts:

```sh
export CLOUDFLARE_API_TOKEN='...'
export CLOUDFLARE_ACCOUNT_ID='...'
npx shortflare@latest deploy
```

Management uses the account's existing `workers.dev` subdomain by default. A
fresh account without one must either register it in Cloudflare first or pass
`--management-domain management.example.com`. The Redirect domain is always a
Custom Domain.

For non-interactive installation, provide the one-time Setup Token through
stdin. It is never accepted as an argument or environment variable:

```sh
printf '%s' "$SETUP_TOKEN" | npx shortflare@latest deploy \
  --json --yes --setup-token-stdin \
  --account-id account-id \
  --redirect-domain go.example.com \
  --administrator-email owner@example.com
```

JSON mode emits exactly one versioned JSON value on stdout. Diagnostics and
progress go to stderr. Use `--dry-run` to receive the exact ordered plan and its
approval digest without mutation.

## Upgrade and interrupted deployment

Run the same command with the same account and domains:

```sh
npx shortflare@latest deploy \
  --account-id account-id \
  --redirect-domain go.example.com
```

The CLI discovers the Instance from the singleton Deployment Marker in D1;
local config is only a non-secret cache. It updates existing Queue retention
without recreating a Queue, preserves `ANALYTICS_HMAC_KEY`, exports D1 before a
pending migration, verifies that export in isolated local D1, and deploys and
checks Management before Redirect. The coherent release changes only after the
schema and both Workers pass verification.

Rerun the same command after an interruption. The D1 Deployment Attempt journal
and fenced lease skip completed actions and revalidate remaining preconditions.
If the observed plan changed, the command stops and prints a new digest instead
of applying stale approval.

Backups default to the platform Shortflare data directory and mode `0600` under
a mode `0700` directory. Use `--backup-dir` for an encrypted external target.
They are never deleted automatically.

## Diagnose and recover

Diagnosis is read-only:

```sh
npx shortflare@latest diagnose --account-id account-id
npx shortflare@latest diagnose --json --account-id account-id
```

Recovery is always a named action and requires `--yes` after diagnosis:

```sh
# Delete only a D1 or Queue that diagnosis reported as an orphan.
npx shortflare@latest recover orphan-resources \
  --account-id account-id --resource primary-queue --yes

# Rotate a lost Setup Token while setup is still eligible.
npx shortflare@latest recover setup-token \
  --account-id account-id --administrator-email owner@example.com --yes

# Restore a known analytics key from stdin, or omit --secret-stdin to rotate.
printf '%s' "$ANALYTICS_KEY" | npx shortflare@latest recover analytics-secret \
  --account-id account-id --secret-stdin --yes

# Activate a previously verified Worker version tag.
npx shortflare@latest recover worker-rollback \
  --account-id account-id --worker management \
  --version-tag 1.2.3-management --yes
```

For Setup Token automation, add `--json --secret-stdin` and pipe the chosen
token. Secret values never appear in JSON. Queue cleanup may fail while the
Management Worker still owns its consumer; remove the consumer Worker before
the primary Queue, then the dead-letter Queue and D1.

Uninstall and broad resource cleanup are intentionally outside the command.
