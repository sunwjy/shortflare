---
status: accepted
---

# Retain sealed Deployment Attempts for the Instance lifetime

An active Deployment Attempt records stage progress. Once it succeeds, fails,
or is abandoned, it is sealed and retained for the lifetime of the Instance.
The record contains plan and release identities, component and schema
identities, stage outcomes and times, backup metadata, normalized error kinds,
and named recovery actions.

Deployment Attempts never contain raw Cloudflare responses, full CLI arguments,
User Emails, Destinations, credentials, tokens, or secret values. Automated
analytics retention and Analytics Erasure do not remove them; a future explicit
Instance removal workflow may do so.

Keeping only the latest attempt was rejected because a later success would erase
the cause and recovery trail of an earlier partial deployment. Time-based
cleanup was rejected because deployment records are sparse and older upgrade or
rollback history remains operationally relevant.
