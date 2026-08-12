# Changelog

All notable changes to the public `shortflare` package are documented here.
Release versions follow SemVer and are reviewed with their declared upgrade and
rollback compatibility.

## [0.1.0] - Unreleased

### Added

- Idempotent and resumable deployment of one Shortflare Instance to an Owner's
  Cloudflare account.
- Prebuilt Management and Redirect Workers, forward-only D1 migrations, Queue
  and dead-letter queue configuration, and a verified release manifest.
- Link lifecycle management, invite-only role-based access, durable
  privacy-aware analytics, security controls, and Administrator Audit browsing.
- Read-only deployment diagnosis and explicitly planned recovery actions.

### Known limitations

- This is an early MVP and is not yet recommended for production use.
- Redirect requires a registered Custom Domain. Management uses the account's
  existing `workers.dev` subdomain unless a Management Custom Domain is given.
- The CLI does not provide uninstall or broad resource cleanup.
- Transactional email delivery is not included; invitation and password-reset
  handoffs require explicit delivery by an Administrator.

### Deferred

- The documented public REST API, API tokens, OpenAPI contract, pagination, and
  webhooks are outside `0.1.0`.
- Campaign, UTM, bulk Link, import/export, richer targeting, and automation
  features remain post-release candidates.
