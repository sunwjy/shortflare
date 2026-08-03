---
status: accepted
---

# Standardize runtime D1 access through Drizzle

Use Drizzle as the runtime D1 access path for production persistence adapters,
not only as the schema and migration source. Adapters keep Drizzle behind their
existing persistence interfaces: callers continue to provide a D1 binding and
never receive a Drizzle client or table model.

Use Drizzle's SQL-like Query Builder for ordinary reads and writes. Parameterized
`sql` templates remain available for atomic guards, `INSERT ... SELECT`, and
correlated queries whose invariants are clearer in SQL; production adapters do
not bypass Drizzle through its underlying D1 client or interpolate dynamic values
with `sql.raw()`. Existing atomic mutations remain D1 batches expressed through
`db.batch()` rather than changing their concurrency model during this refactor.

`@shortflare/database/d1` is the server-only implementation interface for the
typed D1 client and schema. Management's D1 adapters may depend on that subpath
and on Drizzle directly, while HTTP, application, and domain modules must not.
Direct D1 statements remain appropriate for migrations, fixtures, and tests
whose subject is D1 itself.

Keeping native D1 statements in production was rejected because it disconnects
runtime queries from the schema's column and value mappings. Prohibiting SQL was
also rejected because it would obscure the write-time guards that preserve
audit, authorization, and concurrency invariants.
