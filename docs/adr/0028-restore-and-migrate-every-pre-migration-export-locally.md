---
status: accepted
---

# Restore and migrate every pre-migration export locally

Before changing production D1, Deployment Reconciliation imports the complete
pre-migration SQL export into an isolated local D1 database. It verifies the
source Deployment Marker and core Instance, Administrator, Link, Destination
Version, Audit Event, and analytics invariants, applies the target release's
pending migrations, and verifies the target invariants. Any import, migration,
or invariant failure stops the production Deployment Attempt.

The temporary local database is removed after validation while the original
export remains in its backup location. The MVP provides no option to skip this
gate.

Checking only command success and a checksum was rejected because it proves
file transfer, not that the backup can restore or traverse the intended upgrade
path. Manual verification was rejected because a supposedly idempotent upgrade
must enforce its recovery prerequisite consistently.
