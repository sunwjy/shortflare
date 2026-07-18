# Feature Candidates

This document outlines potential features for Shortflare. It is a working list,
not a committed roadmap. Priorities may change as the architecture and user
needs become clearer.

Shortflare should remain focused on being a small, understandable, personal URL
shortener that can be deployed through a simple Cloudflare-oriented workflow.

## MVP

### Link management

- Create, list, search, edit, disable, and delete short links.
- Generate random aliases or accept user-defined aliases.
- Detect reserved paths and alias collisions.
- Store a title, destination, optional tags, timestamps, and link status.
- Support one custom short domain.
- Allow a development or setup domain when a custom domain is unavailable.
- Preserve click history when a destination changes.

### Analytics

- Total clicks and clicks over time.
- Referrer, country, and coarse device category.
- Per-link analytics and a compact all-links overview.
- Date filters and top-link ranking.
- Configurable data retention.
- Privacy-aware collection without persistent visitor fingerprinting.

### Admin UI

- Single-owner authentication and session management.
- Overview dashboard.
- Searchable and filterable link table.
- Link creation and editing forms.
- Link copy action and clear active, disabled, and expired states.
- Link detail page with analytics.

### REST API

- Link creation, retrieval, update, disable, and deletion endpoints.
- Analytics endpoints.
- Hashed bearer tokens with revocation.
- Pagination and consistent error responses.
- OpenAPI documentation.

### UTM Builder

- Support `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, and
  `utm_content`.
- Show a live destination URL preview.
- Encode values correctly and preserve existing query parameters.
- Support optional custom query parameters.
- Integrate UTM fields into the normal link creation and editing flow.
- Expose UTM fields through the REST API.

### Deployment and security baseline

- Provide one documented deployment workflow, ideally ending in
  `npx wrangler deploy`.
- Automate resource provisioning where practical.
- Document migrations, secrets, backup, and restore procedures.
- Validate destination schemes and prevent redirect loops.
- Use secure cookies and protect administrative routes.
- Support configurable rate limits and bot filtering.
- Record administrative mutations in an audit log.

## Next

### Campaigns

- Campaign name, description, status, and optional start and end dates.
- Campaign-level default UTM values.
- Multiple links per campaign.
- Aggregate campaign analytics.
- Channel variants that create distinct short links for the same destination.
- User-defined source and medium mappings for each channel.

A campaign should remain a small grouping and reporting concept. Tags can cover
general organization initially, avoiding a separate folder model with
overlapping responsibilities.

### UTM and reporting improvements

- Reusable named UTM templates.
- Analytics filtering and grouping by UTM values.
- Campaign, link, and analytics CSV export.
- Bulk link creation and import.

### Contained enhancements

- Link expiration with a fallback URL or a clear `410 Gone` response.
- Basic dynamic QR codes with PNG and SVG downloads.
- Separate QR scan attribution.
- Full instance import and export.
- Scoped API tokens such as `links:read`, `links:write`, and
  `analytics:read`.
- Signed click and link webhooks with retry support.

## Later

- Password-protected links.
- Geo-targeted and device-targeted destinations.
- A/B destination testing.
- Custom social cards and link previews.
- Public, optionally password-protected analytics pages.
- Browser, operating system, and city analytics.
- Real-time event streams.
- Multiple custom domains.
- Multiple owners, invitations, and simple roles.
- Third-party automation after the REST API and webhooks are stable.

## Out of scope for now

- Affiliate or referral programs.
- Commission, payout, and revenue-attribution systems.
- Landing-page or link-in-bio builders.
- Mobile deep-link SDKs and app-install attribution.
- Enterprise identity features such as SAML, SSO, and SCIM.
- Fine-grained team and folder permissions.
- A native integration marketplace.
- AI-generated links, social cards, or analytics summaries.
- An advanced QR design studio.
- Link cloaking or iframe-based destination masking.

## Suggested release slices

1. **Usable shortener:** single owner, custom domain, link management, custom
   aliases, redirects, total clicks, and an admin UI.
2. **Useful measurement:** time-series analytics, referrer, country, device,
   REST API, and the UTM Builder.
3. **Campaign workflow:** campaigns, UTM templates, channel variants,
   aggregate reports, and CSV export.
4. **Convenience:** expiration, QR codes, import and export, scoped tokens, and
   webhooks.
