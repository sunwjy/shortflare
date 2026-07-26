---
status: accepted
---

# Bootstrap through a D1 handoff

The deployment CLI writes only a singleton `initial_setup` record after
migrations, before the first Administrator exists, and before the Instance has
ever completed setup. Management consumes it to create the initial User,
credential, and Audit Event and permanently marks setup complete atomically.
This narrow exception to Management's ownership of Identity writes avoids
exposing a public provisioning endpoint while keeping User and credential
invariants out of the deployment CLI.
