# Shortflare Operations

This runbook defines the MVP procedures for migrations, secrets, analytics
retention, Queue recovery, backup, restore, and failure isolation. Commands that
mutate production state must first resolve the exact Instance and show their
target; examples intentionally contain no credentials or resource identifiers.

## Rate limits

Rate limits are best-effort Cloudflare edge abuse controls, not globally exact
counters and not authorization. They never lock a User. All periods are 60
seconds and `/api/internal/health` is excluded.

| Budget | Key | Limit |
| --- | --- | ---: |
| Management pre-check | source IP | 300 |
| Credential exchange | source IP | 10 |
| Login target | normalized User Email | 5 |
| Privileged identity mutation | Actor ID | 10 |
| General Management | User ID | 300 |

A request must pass every applicable budget before expensive password or D1
work. Rejection returns `429`, `Retry-After: 60`, and
`{"ok":false,"kind":"rate-limited"}` without identifying the exhausted key.

## Analytics retention

The Management Worker runs retention at `0 * * * *` UTC by default. An Owner may
change that Cron Trigger in deployment configuration. Cleanup uses the trigger's
scheduled time: raw Click Events and uniqueness records older than exactly 90
days are deleted, while Hourly Rollups use the same boundary rounded down to a
UTC hour. Daily Rollups and Audit Events remain.

The operation is idempotent and needs no lock or checkpoint. A failure remains
visible in Cron Trigger history; do not hide it with an internal retry loop. The
next successful invocation removes every row past the retention boundary.

## Queue and dead-letter recovery

The analytics Queue and DLQ retain messages for 24 hours. Consumers process at
most 10 messages with a one-second batch timeout and one concurrent invocation.
A rejected message retries three times at 60-second intervals before moving to
the DLQ.

Queue retention belongs to the Cloudflare Queue resource rather than the Worker
binding in `wrangler.jsonc`. The deployment CLI creates or updates both
resources with the explicit 86,400-second policy and verifies the resolved
setting before Worker deployment:

For existing resources, inspect and update the resolved Queue settings through
Cloudflare before deploying; do not recreate a non-empty Queue to change this
property.

- A valid or duplicate Click Event is acknowledged independently.
- A malformed, unsupported, conflicting, or invalid-reference Event retries in
  isolation and eventually dead-letters.
- A shared D1 failure leaves every unacknowledged message for redelivery.
- Management downtime does not affect Redirect; queued analytics may be lost
  after the 24-hour retention window.

After fixing the cause, the Owner inspects the target DLQ and message count,
then explicitly replays selected messages or the confirmed set into the primary
Queue. Replay preserves the original Event ID, so already committed Events are
idempotent duplicates. Discard is a separate operation with its own target and
count confirmation. Automatic DLQ replay is prohibited because poison messages
would loop without diagnosis.

## Secrets

`ANALYTICS_HMAC_KEY` is an unpadded base64url-encoded 256-bit Worker Secret. The
deployment workflow generates it once and preserves it on idempotent reruns. It
is never stored as a Wrangler plain-text variable, in non-secret Instance config,
in logs or Audit Events, or in the repository. Local development uses a
gitignored `.dev.vars`; example files list names only.

Cloudflare API credentials come from the interactive login or process
environment and are never copied into Instance config. D1 stores only password
verifiers and hashes of Setup, Invitation, Password Reset, Session, and Operator
Recovery tokens. Treat a SQL export as sensitive even though it contains no
plaintext credential.

Secret rotation is an explicit Owner operation. Rotating the analytics key may
count one Pseudonymous Visitor twice within the half-hour spanning rotation, so
record the time and verify Redirect before and after. A D1 backup does not
contain Worker Secrets; recovery into a new environment must restore the key
separately or generate a new one with this disclosed discontinuity.

## Migrations

1. Change the TypeScript Drizzle schema.
2. Generate a new SQL migration and snapshot with Drizzle Kit.
3. Review the generated SQL; never edit a migration that has been applied.
4. Test both a fresh database and an upgrade from the preceding supported
   release with representative data.
5. List pending production migrations and export D1.
6. Apply pending migrations with Wrangler.
7. Deploy and verify Management, then deploy and verify Redirect.
8. Record the coherent application and schema version only after both pass.

Migrations are forward-only. A failed migration is rolled back while earlier
successful migrations remain recorded, so rerunning continues with pending
files. Application rollback is permitted only while the expanded schema remains
compatible. Destructive changes span expand, migrate, and contract releases.
Use restore, not a down migration, when schema state itself must move backward.

## Backup

D1 Time Travel is the primary recent operational recovery path, subject to the
Owner's current Cloudflare plan. A full SQL export is required immediately
before every production migration or upgrade; a weekly encrypted off-account
export is recommended. Shortflare does not add R2 or an external backup service
in the MVP, so it does not promise a fixed RPO or RTO.

The deployment CLI stores migration exports under the platform-standard
Shortflare user data directory by default, grouped by Cloudflare account, with
user-only file permissions. Each filename identifies the UTC export time and
source and target Shortflare Releases. `--backup-dir` selects another location,
including an encrypted external store. Export failure stops deployment before
the first production migration. The CLI records the D1 bookmark, file path, and
SHA-256 digest in the Deployment Attempt without copying database contents, and
never deletes an export automatically.

Before changing production D1, the deployment CLI verifies the portable export
by importing it into a new isolated local D1 database. It checks the Deployment
Marker, singleton Instance, an Active Administrator, Links and Destination
Versions, Audit Events, and analytics rollups against the source schema, applies
all target migrations locally, and checks the target invariants again. Any
import, migration, or invariant failure stops deployment. The temporary local
database is removed after verification; the SQL export remains. The MVP does
not provide an option to skip this gate.

## Restore

Restore is a maintenance workflow, not a routine mutation.

1. Resolve the exact Instance, recovery timestamp or export, and expected data
   loss; require explicit confirmation.
2. Export the current D1 as a rollback point.
3. Pause Management mutations, Queue consumption, and retention Cron delivery.
4. Restore with D1 Time Travel or import into the validated replacement D1.
5. Apply forward migrations until the schema is compatible with the deployed
   application.
6. Delete every Session and every Initial Setup, Invitation, Password Reset,
   and Operator Recovery handoff before resuming traffic.
7. Verify Instance, Administrator, Link, Destination Version, Audit Event, and
   analytics invariants.
8. Verify Management first, resume Queue and Cron delivery, and finally verify
   an existing Link through Redirect.

Passwords changed after the recovery point revert to their older verifier. The
MVP warns the Owner rather than invalidating every credential. Use a newly
issued Operator Recovery handoff if no Administrator can sign in, then issue
Password Resets as necessary. Queue messages referencing Links or Destination
Versions absent at the recovery point remain invalid and eventually dead-letter.

## Failure boundaries

Management HTTP, UI, Queue consumer, retention Cron, and deployment failures do
not stop existing Links while Redirect and shared D1 remain available. Redirect
does not call Management through HTTP or a Service Binding. Analytics Queue
failure never changes a successful `GET` redirect.

D1 is a shared availability boundary. A warm Cache API entry may continue to
redirect during a D1 outage, but a cache miss or expiry returns `503`. Recovery
verification must test both cases and must not describe D1 failure as merely a
Management outage.
