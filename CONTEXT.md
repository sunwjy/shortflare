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

**User Email**:
An ASCII email address that identifies a User within an Instance. Its trimmed, fully lowercased form is unique and used for matching, while the submitted form is retained for display; provider-specific aliases are not collapsed, and it cannot change after activation in the MVP.
_Avoid_: Username, login ID

**Invited User**:
A User who has been invited but has not completed initial credential setup.
_Avoid_: Pending user

**Active User**:
A User who has completed credential setup and can sign in according to their assigned role. Once activated, a User is retained rather than permanently deleted.
_Avoid_: Enabled user

**Suspended User**:
A User whose access and existing sessions have been revoked without removing their identity or audit history. Reactivation returns the User to Active status with the same role.
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

**Actor**:
A User or the Shortflare system identified as responsible for a successful administrative command.
_Avoid_: Principal

**System Actor**:
The Shortflare system acting without a User session, identified explicitly rather than represented as a fake User.
_Avoid_: Service User, fake User

**Setup Token**:
A 30-minute, single-use secret tied to the initial Administrator's email and accepted only while an Instance has no Active Administrator. Losing or expiring it permits replacement only before the first Active Administrator is created.
_Avoid_: Registration token, bootstrap password

**Invitation**:
A 24-hour, single-use secret through which an Invited User sets an initial password and becomes active in an assigned role. Reissuing one replaces the prior Invitation; cancellation removes the Invited User, while expiration alone does not.
_Avoid_: Invite code, registration

**Password Reset**:
A 30-minute, single-use secret through which an Active User replaces a forgotten password. An Administrator creates and manually delivers it in the MVP; successful use revokes all of the User's Sessions.
_Avoid_: Temporary password, password recovery question

**Operator Recovery**:
A Cloudflare-account-authorized, interactive recovery that lets an existing Active Administrator replace a lost password without reopening initial setup, changing a role, or creating a User.
_Avoid_: Setup reset, backdoor login

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

**Audit Event**:
A retained record of a successful administrative command that changed an Instance, containing identifiers and non-sensitive metadata but not Link titles or Destinations. No-op commands and failed attempts do not produce Audit Events.
_Avoid_: Audit log entry, request log
