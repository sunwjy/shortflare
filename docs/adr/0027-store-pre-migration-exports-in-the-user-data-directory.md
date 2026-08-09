---
status: accepted
---

# Store pre-migration exports in the user data directory

Before applying any production migration, Deployment Reconciliation exports the
complete D1 schema and data. The default destination is an account-specific
directory under the platform-standard Shortflare user data directory, with
user-only permissions. `--backup-dir` supports an Owner-selected encrypted or
external destination. The MVP creates no R2 resource solely for backups.

The filename identifies the UTC export time and source and target Shortflare
Releases. The corresponding Deployment Attempt records the D1 bookmark, path,
and SHA-256 digest but no database contents. A failed or incomplete export stops
the upgrade before migration. The CLI never deletes backups automatically and
prints the final path and sensitive-data warning.

The current working directory was rejected because `npx` deployment is not tied
to a checkout and could scatter or expose sensitive exports. Automatic R2
provisioning was rejected because it expands the MVP resource and credential
surface solely for backup storage.
