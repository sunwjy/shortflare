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
A destination that a Link used during a specific period; changing a Link creates a new Destination Version rather than overwriting the previous one. Analytics is retained both Link-wide and per Destination Version, whose Unique Human Click counts are not additive across Versions.
_Avoid_: Destination history, old URL

**Click Event**:
An analytics observation of a successful `GET` redirect through an Active Link, identified by an immutable Event ID. Redelivery of the same ID and content is the same Click Event, while the same ID with different content is an integrity conflict; `HEAD` requests and responses that do not redirect are not Click Events.
_Avoid_: Redirect event, analytics event

**Click Time**:
The UTC moment when an Active Link successfully redirects the request that produced a Click Event. Analytics buckets and retention use this moment rather than the later ingestion time.
_Avoid_: Ingestion time, processing time

**Human Click**:
A recorded request to a Link that is classified as human rather than a suspected bot. Repeated requests are counted separately.
_Avoid_: Click, visit

**Suspected Bot Click**:
A Click Event classified as likely automated because its transient request metadata is missing or matches a known crawler, link-preview, command-line client, or headless-automation pattern. The classification is approximate, never blocks the redirect, and Suspected Bot Clicks are excluded from Human Click metrics by default.
_Avoid_: Bot, bot click, crawler

**Pseudonymous Visitor**:
A short-lived, Link-scoped representation derived from client IP and User-Agent only while handling a request and used to approximate repeated Human Clicks. The source values are never retained, the representation cannot be correlated across Links, and it is not a person or persistent identity.
_Avoid_: Visitor, unique visitor, fingerprint

**Unique Human Click**:
An approximate count that treats repeated Human Clicks on the same Link by the same Pseudonymous Visitor in one fixed UTC half-hour bucket as one. Hourly and Daily Rollups sum these half-hour counts, so crossing a bucket boundary begins a new count even when less than 30 minutes have elapsed.
_Avoid_: Unique visitor, unique click

**Referrer Domain**:
The lowercase ASCII hostname of a Click Event's valid HTTP or HTTPS referrer, without other URL components. A missing referrer is Direct, while an invalid or unsupported referrer is Unknown; the full referrer URL is never retained.
_Avoid_: Referrer URL, source URL

**Country**:
The uppercase ISO 3166-1 alpha-2 country associated with a Click Event by Cloudflare. Missing, special-purpose, or non-country values are Unknown; finer-grained location data is not retained.
_Avoid_: Location, region, geography

**Device Category**:
One of Desktop, Mobile, Tablet, Other, or Unknown, derived transiently from a Click Event's User-Agent. Browser, operating-system, and device-model details are not retained.
_Avoid_: Device type, platform

**Hourly Rollup**:
Aggregated analytics for one UTC hour, retained for 90 days from that hour. It can be recomputed while its source Click Events remain available.
_Avoid_: Hourly stats, hourly summary

**Daily Rollup**:
Aggregated analytics for one UTC day, retained until explicitly deleted even after its source Click Events expire. A Daily Rollup older than 90 days cannot be recomputed from raw data.
_Avoid_: Daily stats, daily summary

**Analytics Breakdown**:
An analytics metric grouped independently by one of Referrer Domain, Country, Device Category, or bot classification within a Link or Destination Version. Referrer, Country, and Device breakdowns retain Human and Unique Human Clicks; bot classification retains Human and Suspected Bot Clicks, and MVP breakdowns do not combine dimensions.
_Avoid_: Segment, cross-filter

**Analytics Erasure**:
The atomic removal of raw events, uniqueness records, and Hourly and Daily Rollups for one Link or the entire Instance without removing Links or Audit Events. It cannot target a Destination Version, Event ID, or Pseudonymous Visitor.
_Avoid_: Visitor deletion, analytics reset

**Analytics Recalculation**:
The atomic replacement of all uniqueness records and Hourly and Daily Rollups for one Link on one UTC date using retained raw Click Events. A date with incomplete raw retention cannot be recalculated.
_Avoid_: Partial rebuild, analytics refresh

**Archived Link**:
A recoverable Link that no longer redirects while retaining its Alias, analytics, and change history.
_Avoid_: Deleted link, disabled link

**Reserved Alias**:
A formerly public Alias retained after its Link is permanently deleted so that the old URL cannot silently point to an unrelated destination. Releasing it is a separate administrative act.
_Avoid_: Tombstone, deleted alias

**Audit Event**:
A retained record of a successful administrative command that changed an Instance, containing identifiers and non-sensitive metadata but not Link titles or Destinations. No-op commands and failed attempts do not produce Audit Events.
_Avoid_: Audit log entry, request log
