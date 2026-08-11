---
status: accepted
---

# Create the Setup Token after a Coherent Release

On first installation, Deployment Reconciliation deploys and verifies the D1
schema, Management Worker, and Redirect Worker and records the Coherent Release
before creating the Setup Token handoff. It then writes only the token hash to
the singleton `initial_setup` record and prints the plaintext once in the same
interactive completion phase. Non-interactive deployment accepts an explicitly
supplied secret and suppresses output.

A rerun preserves an unexpired pending token. If the Owner did not receive its
plaintext, replacement requires explicit rotation and is allowed only before an
Active Administrator exists and before setup has ever completed. The plaintext
is never stored in local Instance configuration.

Creating the token before Worker deployment was rejected because a later
deployment failure or process exit could leave a valid hash whose plaintext was
never delivered. Persisting the plaintext locally was rejected because it would
turn repeatability configuration into a credential store.
