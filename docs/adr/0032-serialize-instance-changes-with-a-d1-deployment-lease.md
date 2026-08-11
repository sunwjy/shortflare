---
status: accepted
---

# Serialize Instance changes with a D1 Deployment Lease

Every mutating `deploy` or `recover` run acquires one expiring Deployment Lease
in the Instance D1 database. The lease records its Deployment Attempt, expiry,
and a monotonically increasing fencing token. The holder renews the lease
during work and revalidates the token before each external effect so an expired
process cannot continue after another attempt takes ownership.

A competing run reports the active attempt and lease expiry and stops rather
than waiting or forcing release. After expiry, a new run may acquire a higher
fencing token only after re-observing all Cloudflare and D1 state and creating a
new Deployment Plan. `diagnose` remains lease-free because it is read-only. The
MVP provides no force-unlock operation.

Relying on idempotency alone was rejected because two independently valid plans
can still interleave unsafe actions. A local file lock was rejected because it
cannot serialize another computer or CI runner.
