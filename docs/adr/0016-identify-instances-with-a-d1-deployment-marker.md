---
status: accepted
---

# Identify Instances with a D1 Deployment Marker

Deployment Reconciliation identifies an existing Instance by the authenticated
Cloudflare account and an immutable Deployment Marker in its D1 database. Local
Instance configuration and conventional resource names are discovery hints and
caches only; neither grants authority to mutate a resource.

The CLI validates the marker before reconciling an existing Instance. A
same-named database without a valid marker is a collision, so the CLI stops
without adopting or changing it. Trusting local configuration alone was
rejected because losing the file would prevent recovery on another machine.
Automatically adopting conventional names was rejected because it could damage
unrelated resources in the Owner's account.

On first installation, the CLI creates D1 and writes its Deployment Marker
before provisioning any other Instance resource. If the marker write does not
complete, the database is an Orphan Resource. A later deployment reports the
exact collision and recovery choices but does not adopt, mutate, or delete the
database based on its name, apparent emptiness, or local configuration. The
Owner must explicitly recover or remove the orphan before installation can
continue.
