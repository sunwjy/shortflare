# shortflare

> The `0.1.0` package is in pre-release hardening and has not been published to
> npm. The command below will become available with the first public release.

Shortflare is an open-source URL shortener designed to run in your own
Cloudflare account. This package contains the deployment CLI, prebuilt
Management and Redirect Workers, D1 migrations, and a verified release
manifest.

## Requirements

- Node.js 22.12 or newer
- A Cloudflare account and account ID
- A registered domain for the required Redirect Custom Domain
- A scoped Cloudflare API Token

Use a token restricted to the target account and selected zones. It needs
Account `Workers Scripts: Write`, `D1: Edit`, `Queues: Edit`, `Pages: Read`, and
`Zone: Read`, plus Zone `DNS: Read` and `Workers Routes: Write`. Do not use a
Global API Key or broader account token.

## Install or upgrade

```sh
export CLOUDFLARE_API_TOKEN='...'
export CLOUDFLARE_ACCOUNT_ID='...'
npx shortflare@latest deploy
```

The command shows the exact reconciliation plan before applying it. Rerun the
same command to resume an interrupted deployment or upgrade a supported
Instance. Shortflare preserves the existing Redirect deployment until the new
Management Worker, schema, and Redirect Worker form a verified Coherent
Release.

For automation, pass `--json --yes` with the account, domains, Administrator
email, and required secrets through stdin. Secret values are never accepted as
command arguments or written to the Instance config.

## Diagnose and recover

Diagnosis is read-only and supports a separately scoped read token:

```sh
npx shortflare@latest diagnose --account-id account-id
```

Recovery is always an explicitly named action. First inspect the proposed plan,
then repeat it with the printed digest:

```sh
npx shortflare@latest recover setup-token \
  --account-id account-id --administrator-email owner@example.com
# Repeat with: --approve-digest <digest>
```

The CLI also supports diagnosed orphan-resource cleanup, analytics-secret
recovery, and verified Worker rollback. It does not provide uninstall or broad
resource cleanup.

See the complete
[deployment guide for v0.1.0](https://github.com/sunwjy/shortflare/blob/v0.1.0/docs/deployment.md)
for non-interactive input, least-privilege diagnosis, backup locations,
interrupted deployment, and recovery ordering.

## Release status

`0.1.0` is an early MVP and is not yet recommended for production use. See the
[changelog](CHANGELOG.md) for implemented behavior, known limitations, and
deferred public APIs.

Shortflare is available under the MIT License. Bundled third-party code and font
licenses are reproduced in `THIRD_PARTY_NOTICES.md`.
