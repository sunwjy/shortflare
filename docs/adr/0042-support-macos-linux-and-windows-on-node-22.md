---
status: accepted
---

# Support macOS, Linux, and Windows on Node 22

The public CLI supports macOS, Linux, and Windows on Node.js `>=22.13.0`. Its
reconciliation core uses Node APIs and argument-array subprocess execution
rather than shell scripts or Unix-only commands. Platform adapters own standard
config and data locations, temporary files, atomic replacement, and the closest
available user-only permission semantics.

Pull requests run planner, CLI, fake-adapter, and `npm pack` tests on all three
operating systems. The real Cloudflare release smoke runs once on Linux because
the deployed control-plane behavior is OS-independent. An unsupported Node
version fails before authentication, file creation, or Cloudflare access.

Unix-only support was rejected because a public `npx` installation interface
implies a portable Node CLI and would otherwise require a separate Windows
deployment path.
