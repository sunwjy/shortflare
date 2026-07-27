---
status: accepted
---

# Reject stale Link mutations

Expose a Link revision through the internal Management API and require its
`expectedRevision` for every mutation targeting an existing Link, including
editing, state transitions, and permanent deletion. If the stored revision has
changed, reject the complete command as `409 link-conflict` so concurrent work
cannot be silently overwritten.

This replaces last-write-wins Link mutations and means simultaneous Destination
changes no longer both succeed automatically. It adds explicit client conflict
handling, but preserves a User's opportunity to review and reapply stale work
instead of merging it implicitly. Link creation and Reserved Alias release do
not target an existing Link and therefore do not use a Link revision.

Revision validation precedes no-op detection. A stale command returns
`link-conflict` even when its requested values happen to match the latest Link.
