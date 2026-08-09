---
status: accepted
---

# Declare Supported Upgrades in release manifests

Every Shortflare Release manifest declares the source Coherent Releases and
schema versions from which it supports a direct upgrade. Deployment
Reconciliation rejects an unsupported source or downgrade before creating a
backup or mutating Cloudflare resources, and reports the exact intermediate
release needed to reach the target safely.

The initial compatibility policy supports fresh installation and direct upgrade
from the immediately preceding stable release. Supporting a wider range requires
that release to test and declare the additional paths explicitly. The presence
of a continuous sequence of pending migrations is not proof of compatibility:
skipping releases can bypass runtime data transitions and the staged
expand/migrate/contract guarantees shared by the schema and both Workers.
