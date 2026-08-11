---
status: accepted
---

# Delete only manifest-declared owned resources

Deployment Reconciliation never deletes an unexpected, similarly named, or
unmarked Cloudflare resource merely to match desired state. A destructive
action may enter a Deployment Plan only when the target Shortflare Release
manifest declares the exact managed resource transition and live inspection
proves that the resource belongs to the verified Instance.

Every destructive action requires separate Owner approval tied to the concrete
plan in both interactive and non-interactive operation. If approval or ownership
proof is absent, deployment preserves the existing service and stops. Queue
cleanup always removes its consumer binding before deleting the consumer Worker
or Queue, matching Cloudflare's resource constraint.

Orphan Resources are outside routine deployment because they have no valid
Deployment Marker. They may be removed only through an explicit recovery flow.
Deleting all observed drift was rejected because unrelated account resources
are not part of Shortflare's desired state. Prohibiting every release-declared
deletion was rejected because future contract releases could never retire a
verified managed resource safely.
