---
status: accepted
---

# Never rotate a missing analytics secret implicitly

On first installation, Deployment Reconciliation generates a 256-bit
`ANALYTICS_HMAC_KEY` and writes it directly to Cloudflare as a Worker Secret. A
rerun verifies the secret name and preserves the opaque value without reading
or copying it. Deployment does not store the value in local Instance
configuration, D1, Deployment Attempts, logs, or command-line arguments.

If the secret is absent from an existing Instance, deployment stops before
changing either Worker. The Owner must either restore the same value through
standard input or explicitly authorize rotation. Rotation records only
non-secret metadata and warns that one Pseudonymous Visitor may be counted
twice in the UTC half-hour spanning the change.

Implicit regeneration was rejected because a missing binding is evidence of
drift, not permission to change analytics identity. Local secret backup was
rejected because it would turn non-secret repeatability configuration into a
credential store.
