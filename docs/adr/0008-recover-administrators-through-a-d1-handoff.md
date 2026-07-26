---
status: accepted
---

# Recover Administrators through a D1 handoff

An interactive CLI authenticated to the Instance's Cloudflare account may
write a 30-minute `operator_recovery` handoff for one existing Active
Administrator. Management consumes it to replace only that User's password,
revoke Sessions, and audit the System Actor; this avoids a public recovery
endpoint and never reopens setup, creates or reactivates a User, or changes a
role.
