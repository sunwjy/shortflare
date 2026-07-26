---
status: accepted
---

# Edit a Link atomically

Expose Link editing as one command that may change the title, the Destination,
or both, and persist the complete edit atomically with one Audit Event. A
changed Destination appends a Destination Version, while any validation or
persistence failure leaves both fields unchanged.

This replaces the Links interface's separate title and Destination commands
with one `edit` command and one atomic persistence operation. It changes the
existing module contract, but prevents every current and future caller from
having to recover from partially successful edits.

One successful edit produces at most one Audit Event. Its metadata identifies
only the fields that actually changed and the new Destination Version ID when
applicable; it never copies a title or Destination.
