---
status: accepted
---

# Require plan-scoped least-privilege Cloudflare tokens

Non-interactive operation documents the minimum Cloudflare read and write
permissions required by each command and scopes tokens to the selected account
and Redirect and Management zones. `diagnose` has a separate read-only profile
where Cloudflare permits it. Shortflare does not require account administrator
credentials or recommend the broad default Workers template, which includes
unrelated products while omitting parts of Shortflare's D1-oriented needs.

Preflight verifies token activity, account access, and every safe product list
or read operation needed to observe a Deployment Plan. It does not create dummy
resources to test write access and does not claim that unobservable permissions
were verified. A Cloudflare `403` is reported as authorization failure for the
exact product, resource, and required permission rather than as invalid
authentication.

Broad account credentials were rejected because one compromised deployment
environment should not control unrelated resources. Relying on a generic token
template was rejected because its product scope does not match the D1, Queues,
Workers, and selected-zone operations in a Shortflare plan.
