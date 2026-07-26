# Shortflare

Shortflare is an open-source URL shortening service designed to make the most
of Cloudflare's infrastructure. Its goal is to let anyone deploy and own a URL
shortener in their Cloudflare account with a single command.

> [!IMPORTANT]
> Shortflare is currently in the idea and early development stage. It is not
> ready for production use, and the features and deployment workflow described
> below are goals rather than guarantees.

## Vision

Running a personal URL shortener should not require managing servers or
depending on a hosted shortening provider. Shortflare aims to offer a small,
self-hosted service that can be deployed to a user's own Cloudflare account,
with an ideal deployment experience as simple as:

```sh
npx shortflare@latest deploy
```

The target system design and Cloudflare resources are documented in
[the architecture](docs/architecture.md).

## Planned features

The initial version of Shortflare is expected to include:

- Custom short paths
- Click analytics
- A management UI

A documented REST API is planned after the first usable release.

## Project goals

- Make deployment simple, ideally requiring only one CLI command
- Keep each Shortflare instance under its owner's control
- Use Cloudflare's infrastructure where it provides a good fit
- Provide a focused, understandable, and open-source codebase

## Status

Shortflare is at an early stage. The target architecture and initial product
scope are documented, but the implementation and public API are not ready yet.

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

During local development, Management exposes a temporary Link creation endpoint
for the first end-to-end vertical slice. Use the Management URL printed by
Vite:

```sh
curl --request POST "$MANAGEMENT_URL/api/internal/links" \
  --header "content-type: application/json" \
  --data '{
    "alias": "Docs",
    "title": "Documentation",
    "destination": "https://example.com/guide"
  }'
```

The endpoint is included only in Vite development mode. Production builds
return `404`, and the endpoint will be removed when authenticated management
operations replace it.

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

Shortflare will be released under the MIT License.
