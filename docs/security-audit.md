# Dependency security audit

Shortflare separates the dependencies shipped to an npm consumer from tools
used only to build, test, lint, or develop the repository. The release gate is
the production tree:

```sh
pnpm audit --prod --audit-level high
```

This command runs independently from `pnpm check` because it requires live npm
advisory data. Pull requests and `main` run it in the `Security` workflow, and
any high or critical production advisory fails the job. There is no advisory
allowlist or dependency override.

## Production audit snapshot

Audited on 2026-08-13 with `pnpm@11.15.0` and the committed lockfile. The full
production audit reports zero advisories at every severity.

The remediation uses direct, exact dependencies that had cleared pnpm's
24-hour release-age quarantine when selected:

| Dependency path | Resolved version |
| --- | --- |
| `shortflare > wrangler` | `4.120.1` |
| `shortflare > wrangler > miniflare` | `5.20260804.0-alpha` |
| `shortflare > wrangler > miniflare > sharp` | `0.35.2` |
| `shortflare > wrangler > miniflare > undici` | `7.29.0` |
| Worker bundles' direct Hono dependency | `4.13.1` |

`packages/deploy/production-dependency-policy.json` records the intended npm
runtime path. `pnpm --filter ./packages/deploy verify:runtime-deps` creates the
actual pnpm tarball, installs it in an isolated npm consumer, and rejects a
missing path or version mismatch. No release-age exclusion was added for this
remediation.

The upgrade removed these production findings:

| Advisory | Previous path | Resolution |
| --- | --- | --- |
| `GHSA-f88m-g3jw-g9cj` | `shortflare > wrangler > miniflare > sharp@0.34.5` | Sharp `0.35.2` through Wrangler `4.120.1` |
| `GHSA-4cwx-7wf7-3272` | `shortflare > wrangler > miniflare > undici@7.28.0` | Undici `7.29.0` through Wrangler `4.120.1` |
| `GHSA-8j4g-w8fx-2239` | Worker bundles using `hono@4.12.31` | Direct Hono upgrade to `4.13.1` |
| `GHSA-f23p-vx2j-j53r` | Worker bundles using `hono@4.12.31` | Direct Hono upgrade to `4.13.1` |
| `GHSA-79qm-7rj5-m7r9` | Worker bundles using `hono@4.12.31` | Direct Hono upgrade to `4.13.1` |
| `GHSA-54fx-42gc-7vw4` | Worker bundles using `hono@4.12.31` | Direct Hono upgrade to `4.13.1` |

There is no residual accepted production dependency risk in this snapshot.

## Updating shipped dependencies

When changing a dependency shipped in the CLI or Worker bundles:

1. Select a release that has cleared the repository's 24-hour release-age
   policy without adding a new exclusion.
2. Regenerate the lockfile and inspect changes to the production tree.
3. If Wrangler's resolved runtime path or versions change, update
   `packages/deploy/production-dependency-policy.json` and its regression tests.
   The verifier implementation only needs modification when the expected
   dependency-tree structure or validation contract changes.
4. Regenerate `packages/deploy/THIRD_PARTY_NOTICES.md` when shipped packages or
   versions change.
5. Run:
   - `pnpm audit:prod`
   - `pnpm exec turbo run build --filter=./packages/deploy`
   - `pnpm --filter ./packages/deploy verify:runtime-deps`
   - `CI=true pnpm check`
6. Update the production audit snapshot and document any residual risk.

Do not weaken the verification by removing an expected dependency, accepting a
version range, adding an audit allowlist, or introducing a release-age exception
without a separately documented security decision.

## Development-only audit snapshot

The unscoped `pnpm audit` reports 6 high and 7 moderate development-only
advisories. They do not appear in `pnpm audit --prod` or in the installed
`shortflare` tarball, so they do not weaken the production release gate. They
can still affect trusted build and development processes and are tracked in
[Issue #29](https://github.com/sunwjy/shortflare/issues/29).

| Advisory | Severity | Development-only path and current exposure |
| --- | --- | --- |
| `GHSA-f88m-g3jw-g9cj` | High | Sharp through Cloudflare Vite/Vitest tooling; local Worker simulation and tests only |
| `GHSA-4cwx-7wf7-3272` | High | Undici through Cloudflare, Vitest, JSDOM, and shadcn tooling; development HTTP clients only |
| `GHSA-7p8r-x3mc-p8w7` | High | `fast-uri` through shadcn's MCP/configuration tooling; component tooling only |
| `GHSA-rgw5-rvv9-x895` | High | `brace-expansion` through ESLint and shadcn tooling; lint/generation inputs only |
| `GHSA-5p4m-2wfm-xmqj` | High | `js-yaml` through shadcn's Cosmiconfig tree; component configuration only |
| `GHSA-2v37-7h3g-55p8` | High | Nano ID through Vite/PostCSS; build and development transformation only |
| `GHSA-67mh-4wv8-2f99` | Moderate | esbuild through Drizzle Kit's legacy loader; schema tooling only |
| `GHSA-frvp-7c67-39w9` | Moderate | Hono Node server through shadcn's MCP tooling; local tooling server only |
| `GHSA-fxqj-rqcc-2cmp` | Moderate | PostCSS through Vite and shadcn; trusted repository stylesheets only |
| `GHSA-8xcm-r25x-g524` | Moderate | Undici through Cloudflare, Vitest, JSDOM, and shadcn tooling |
| `GHSA-m8rv-5g2x-5cg5` | Moderate | Undici through Cloudflare, Vitest, JSDOM, and shadcn tooling |
| `GHSA-jr45-8vmc-qm54` | Moderate | Undici through Cloudflare, Vitest, JSDOM, and shadcn tooling |
| `GHSA-v3r7-h72x-cjcm` | Moderate | Undici through Cloudflare, Vitest, JSDOM, and shadcn tooling |

Until Issue #29 is resolved, do not expose development servers to untrusted
networks or run repository tooling against untrusted configuration and source
files. Re-run both audit commands whenever the lockfile changes or npm publishes
a relevant advisory.
