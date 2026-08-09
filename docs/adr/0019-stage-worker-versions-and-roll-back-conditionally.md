---
status: accepted
---

# Stage Worker versions and roll back conditionally

Deployment Reconciliation uploads both target Worker versions without traffic,
then activates and verifies Management before activating and verifying Redirect.
A failure before activation leaves the verified deployment serving traffic and
is resumed forward by the next run.

If an activated Worker fails verification, the CLI returns only that Worker to
its previously verified version and only when the Shortflare Release declares a
Rollback-Safe Upgrade and live inspection confirms that the migrated schema and
current bindings remain compatible. Otherwise it records the failed Deployment
Attempt, preserves the observed resources, and reports exact recovery actions
without guessing destructively.

Unconditional rollback was rejected because Cloudflare Worker rollback does not
restore connected resources and a prior version may no longer match their
bindings or schema. Never rolling back was rejected because it would leave a
known-bad Worker serving traffic even when the preceding verified version is
provably safe.
