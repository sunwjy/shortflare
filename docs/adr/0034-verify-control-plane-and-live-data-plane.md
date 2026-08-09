---
status: accepted
---

# Verify the control plane and live data plane

A Deployment Attempt records a Coherent Release only after verifying D1 marker,
schema and release metadata; Worker versions and D1, Queue, and secret bindings;
Queue producer, consumer, dead-letter, retry, and retention settings; and Custom
Domain TLS readiness. It also calls the Management health endpoint and Redirect
root through their deployed addresses.

When an Active Link exists, verification sends `HEAD` to its Alias and checks
the expected redirect status and `Location`. `HEAD` is deliberately excluded
from Click Events, so this proves the live Link path without contaminating
analytics. Production deployment never inserts a synthetic analytics event.

A bounded readiness timeout leaves the Deployment Attempt incomplete and
resumable. Metadata-only verification was rejected because valid configuration
does not prove the deployed path serves traffic. HTTP-only verification was
rejected because an endpoint can respond while a Queue, dead-letter policy, or
version binding remains wrong.
