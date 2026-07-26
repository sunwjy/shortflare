---
status: accepted
---

# Use one D1 database per Instance

Treat each D1 database as the storage boundary for exactly one Instance, with a
singleton Instance record and no repeated Instance ID on Link, Alias,
Destination Version, or Audit Event records. This keeps independently owned
installations simple and prevents latent multi-tenancy from complicating every
query and constraint; supporting multiple Instances in one database would
require an explicit future schema and deployment-model change.
