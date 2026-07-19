---
status: accepted
---

# Split redirect and management into separate Workers

Run redirects and management as separate Cloudflare Workers that share D1 and a
Queue but have no Service Binding between them. This adds ordered multi-Worker
deployment, but prevents management code, UI failures, and authentication work
from becoming availability or latency dependencies of the public redirect path.

## Consequences

The Shortflare CLI deploys Management before Redirect and treats both Workers
and the D1 schema as one coherent application version. Redirect reads Link state
directly from D1, uses a five-second local cache, and emits analytics through
Queue so Management downtime cannot stop existing redirects.
