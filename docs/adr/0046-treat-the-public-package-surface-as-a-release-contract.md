---
status: accepted
---

# Treat the public package surface as a release contract

The `shortflare` npm tarball is the public distribution of one coherent
Shortflare Release, so its legal files, metadata, documentation, release notes,
CLI, Workers, migrations, and manifest are reviewed as one Public Package
Surface. An exact committed path allowlist rejects additions that were not
reviewed; the release manifest continues to attest the contents of executable
artifacts.

The repository-root MIT license is authoritative and release assembly copies it
byte-for-byte to the package root. A reviewed `THIRD_PARTY_NOTICES` covers all
third-party code and assets shipped in the built artifacts, with deterministic
verification rejecting unknown or disallowed licenses. The package-local
`CHANGELOG.md` is the single release-note source and remains marked Unreleased
until publication.

The packed README is a self-contained installation entrypoint and links to the
deployment guide at the matching Git tag rather than mutable `main`. Shortflare
uses manually reviewed SemVer because a version change also requires explicit
upgrade and rollback compatibility declarations; Changesets is deferred until
release cadence or contributor volume demonstrates a need for it.
