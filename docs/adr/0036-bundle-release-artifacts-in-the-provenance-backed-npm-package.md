---
status: accepted
---

# Bundle release artifacts in the provenance-backed npm package

The public `shortflare` npm package is a self-contained deployment unit. It
contains the CLI executable, both prebuilt Worker bundles, all required D1
migrations, resource templates, and a Shortflare Release manifest. The manifest
declares release and schema compatibility, rollback safety, and the SHA-256
digest of every bundled artifact; the CLI verifies the bundle before planning a
Cloudflare mutation.

Publishing uses GitHub Actions OIDC trusted publishing with npm provenance. The
`latest` dist-tag contains stable releases only, while prereleases use separate
tags. Runtime deployment never builds from the current working directory or
downloads Worker or migration artifacts from GitHub Releases.

Checkout builds were rejected because `npx` deployment must not depend on a
repository or local toolchain. Runtime downloads were rejected because they
could combine independently changing sources and add another availability and
integrity boundary after npm has already delivered the selected release.
