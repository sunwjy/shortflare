---
status: accepted
---

# Preserve Aliases through archival

An Archived Link keeps its Alias so it can be restored without letting an old
public URL silently identify unrelated content. Restoring always produces a
Disabled Link, and only an Archived Link can be permanently deleted. Permanent
deletion replaces the Link with a Reserved Alias that returns `410 Gone`;
releasing that Alias is a separate Administrator-only action and is allowed
only after deletion.

This favors recoverability and public-URL safety over immediately recycling
Aliases. It also makes destructive intent explicit: archive, permanently
delete, and release are three distinct steps.
