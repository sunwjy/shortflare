---
status: accepted
---

# Separate human output from versioned JSON results

The CLI defaults to interactive human-readable progress, Deployment Plans,
confirmation, and recovery guidance. `--json` is a prompt-free mode whose
stdout contains one versioned JSON result; progress is written to stderr so
automation never has to parse mixed output.

Machine results identify the Deployment Attempt and plan digest, source and
target releases, completed stages, backup path, endpoints, and final state.
Errors expose a stable kind, failed stage, retryability, and named recovery
action rather than raw Cloudflare responses. Stable exit-code categories
distinguish invalid input, authentication or authorization, conflicts or
critical drift, missing approval, transient Cloudflare failure, and verification
failure. Credentials, Worker Secrets, and Setup Token plaintext never appear in
JSON or logs.

Human-only output was rejected because CI would depend on unstable prose.
Mixing progress and JSON on stdout was rejected because it makes successful
parsing timing-dependent and fragile.
