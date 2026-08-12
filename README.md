# Shortflare

Shortflare is an open-source URL shortening service designed to make the most
of Cloudflare's infrastructure. Its goal is to let anyone deploy and own a URL
shortener in their Cloudflare account with a single command.

> [!IMPORTANT]
> The Shortflare MVP is implemented on `main`, but version `0.1.0` is still in
> pre-release hardening. The npm package has not been published, and Shortflare
> is not yet recommended for production use.

## Vision

Running a personal URL shortener should not require managing servers or
depending on a hosted shortening provider. Shortflare aims to offer a small,
self-hosted service that can be deployed to a user's own Cloudflare account,
with a deployment experience as simple as the following after the first public
release:

```sh
npx shortflare@latest deploy
```

The target system design and Cloudflare resources are documented in
[the architecture](docs/architecture.md). Installation, upgrade, diagnosis,
and interrupted-deployment recovery are documented in the
[deployment guide](docs/deployment.md).

## MVP scope

The implemented MVP includes:

- Link management and custom short paths
- Invite-only Users with Administrator, Member, and Viewer roles
- Durable, privacy-aware click analytics
- A management UI with Link, Analytics, User, Security, and Audit flows
- An idempotent Cloudflare deployment, diagnosis, and recovery CLI

A documented REST API is planned after the first usable release.

## Project goals

- Make deployment simple, ideally requiring only one CLI command
- Keep each Shortflare instance under its owner's control
- Use Cloudflare's infrastructure where it provides a good fit
- Provide a focused, understandable, and open-source codebase

## Status

The MVP implementation and its acceptance criteria are complete. The project is
now auditing and resolving the legal, packaging, security, CI, browser, and
Cloudflare release-gate work required for the first public `0.1.0` release.

There is currently no npm release, Git tag, or GitHub Release. Commands using
`npx shortflare` are documented for the future public package and are not
available yet. The public REST API remains outside the MVP.

## Development

The monorepo uses pnpm, Turborepo, TypeScript, Oxlint, Oxfmt, and Vitest.

```sh
pnpm install
pnpm check
pnpm dev
```

`pnpm dev` starts the Redirect and Management Workers through Vite's Cloudflare
runtime integration. Run a single workspace with `pnpm --filter <workspace> dev`.

Apply the versioned migrations to the local D1 database with:

```sh
pnpm --filter @shortflare/management db:migrate:local
```

Management exposes `POST /api/internal/links` as an authenticated
Administrator/Member operation. It requires the host-only Session cookie, the
exact Management origin, and the Session's CSRF token. The local integration
suite performs initial Administrator setup and login before creating a Link.

The Redirect integration suite verifies the local Management HTTP → shared D1
→ Redirect HTTP flow:

```sh
pnpm --filter @shortflare/redirect-worker test
```

If you are interested in shaping the project, you can share ideas or follow its
progress through [GitHub Issues](https://github.com/sunwjy/shortflare/issues).

## Cloudflare disclaimer

Shortflare is an independent open-source project. It is not affiliated with,
endorsed by, or sponsored by Cloudflare, Inc. Cloudflare's platform is being
considered because its infrastructure appears well suited to the project's
goals.

Cloudflare and related product names are trademarks of Cloudflare, Inc.

## License

Shortflare is available under the [MIT License](LICENSE). Bundled third-party
code and font notices are included with the public npm package.
