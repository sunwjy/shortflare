# Shortflare

Shortflare provides independently owned URL-shortening installations for personal use and small teams.

## Language

**Instance**:
An independently owned Shortflare installation, including its links, settings, and analytics data.
_Avoid_: Tenant, workspace

**Owner**:
The person or small team that controls an Instance and its data.
_Avoid_: Customer, tenant

**User**:
An invited person who can sign in to an Instance's management interface.
_Avoid_: Account, owner

**Invited User**:
A User who has been invited but has not completed initial credential setup.
_Avoid_: Pending user

**Active User**:
A User who can sign in according to their assigned role.
_Avoid_: Enabled user

**Suspended User**:
A User whose access and existing sessions have been revoked without removing their identity or audit history.
_Avoid_: Disabled user, deleted user

**Administrator**:
A User who can manage Users, Instance settings, Links, and analytics.
_Avoid_: Admin user, owner

**Member**:
A User who can manage Links and view analytics but cannot manage Users or Instance settings.
_Avoid_: Editor

**Viewer**:
A User who can view analytics without changing Links, Users, or Instance settings.
_Avoid_: Read-only member

**Link**:
A stable short path whose destination and analytics history continue across destination changes.
_Avoid_: Short URL, redirect

**Alias**:
A case-sensitive, single-segment path that identifies a Link within an Instance. A custom Alias is 1 to 64 ASCII letters, digits, hyphens, or underscores; an automatically generated Alias is six Base62 characters.
_Avoid_: Slug, back-half, short code

**Active Link**:
A Link that redirects requests to its current Destination Version.
_Avoid_: Enabled link, live link

**Disabled Link**:
A non-redirecting Link that remains visible in normal management views and keeps its Alias, analytics, and change history. A restored Link enters this state until explicitly activated.
_Avoid_: Deleted link, archived link

**Destination Version**:
A destination that a Link used during a specific period. Changing a Link creates a new Destination Version rather than overwriting the previous one.
_Avoid_: Destination history, old URL

**Human Click**:
A recorded request to a Link that is classified as human rather than a suspected bot. Repeated requests are counted separately.
_Avoid_: Click, visit

**Unique Human Click**:
An approximate count that treats repeated Human Clicks on the same Link by the same pseudonymous visitor within 30 minutes as one.
_Avoid_: Unique visitor, unique click

**Archived Link**:
A recoverable Link that no longer redirects while retaining its Alias, analytics, and change history.
_Avoid_: Deleted link, disabled link

**Reserved Alias**:
A formerly public Alias retained after its Link is permanently deleted so that the old URL cannot silently point to an unrelated destination. Releasing it is a separate administrative act.
_Avoid_: Tombstone, deleted alias
