---
status: accepted
---

# Give the CLI a narrow Deployment Control schema

The deployment CLI directly owns only the D1 records needed to identify and
coordinate an Instance: Deployment Marker, Deployment Attempts, Deployment
Lease and fencing token, Coherent Release, and schema compatibility metadata.
It also applies versioned migrations and retains the existing narrow authority
to write `initial_setup` and `operator_recovery` handoffs.

The CLI never writes User, credential, Session, Link, Destination Version,
Reserved Alias, Click Event, analytics rollup, Audit Event, or other
Management-owned business records. Those domains remain behind their existing
application interfaces and persistence adapters.

Requiring a Management endpoint was rejected because first installation and
Management outage recovery must operate before or without a reachable Worker.
Allowing arbitrary direct D1 writes was rejected because deployment must not
bypass application invariants or become a second owner of business data.
