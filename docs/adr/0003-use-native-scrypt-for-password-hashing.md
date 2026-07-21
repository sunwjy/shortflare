---
status: accepted
---

# Use native scrypt for password hashing

Hash User passwords in the Management Worker with asynchronous
`node:crypto.scrypt`, enabled by `nodejs_compat`. The initial policy uses
`N=32768`, `r=8`, `p=1`, a fresh 16-byte salt, and a 32-byte derived key with an
explicit 48 MiB `maxmem` guard.

Store a versioned, self-describing verifier containing the algorithm, all work
factors, salt, output length, and derived key. Verification accepts only
whitelisted parameter sets and uses a timing-safe comparison. Rehash after a
successful login whenever the stored policy differs from the current policy.

## Consequences

Password authentication requires a Paid Workers plan. The selected parameters
took a 57 ms median in the pinned local workerd runtime, which exceeds the Free
plan's 10 ms request CPU budget. Authentication implementation must complete a
deployed CPU and concurrency smoke test before release.

The 32 MiB setting leaves more of the 128 MB isolate limit available to the
application and concurrent requests than the tested 64 MiB setting. If deployed
testing demonstrates adequate headroom, increase the default to `N=65536` and
rehash existing verifiers on login.

Native Argon2id is unavailable in the pinned workerd runtime. Pure-JavaScript
Argon2id, pure-JavaScript scrypt, bcrypt, and PBKDF2 were rejected for new
hashes because of implementation disadvantage, latency, input truncation, or
the lack of memory hardness. The measurements and source evidence are recorded
in `docs/research/password-kdf-workers.md`.
