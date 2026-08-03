---
status: accepted
---

# Own the Management UI through shadcn, Tailwind, and TanStack Form

Use shadcn/ui's `base-nova` style as the source-owned component layer, Base UI
as its accessible behavior primitive, Tailwind CSS as the utility-first styling
engine, TanStack Form as the client form-state module, Zod as its Standard
Schema validator, and Lucide React as the single outlined icon family.

Shortflare maps its accepted design tokens onto shadcn's semantic token
interface. Theme values remain Shortflare-owned: generated defaults must not
replace the product's brand, density, state, or contrast rules. Light, Dark,
and System preferences resolve to the same semantic tokens; the active dark
theme is represented by the `dark` class on the document root.

Tailwind utilities own component layout, spacing, responsive behavior, and
visual state. Global CSS is limited to Tailwind and font imports, theme token
definitions, and genuinely document-wide base rules. Do not recreate
component-level utility combinations as semantic CSS classes.

Files under `components/ui` stay close to the shadcn registry and contain only
reusable visual and interaction primitives. Domain compositions belong to the
feature that owns their behavior. Shared form fields hide TanStack Form and
ARIA wiring behind a small interface, but feature modules continue to own
their defaults, validation schema, and submission behavior. Do not introduce a
configuration-driven form builder.

TanStack Form manages mutation forms, including authentication, credentials,
User invitations, Link creation and editing, and sensitive Alias confirmation.
Search and filter state remains owned by TanStack Router or its feature. Reuse
pure domain Zod schemas where their interface matches the form; keep
presentation-only validation local. Client validation improves feedback but
never replaces server validation, which remains authoritative. Server
rejections must be represented as field or form errors instead of being hidden
inside the form module.

Astryx was considered but is not adopted or retained as a future candidate. Its
separate component and theming system would compete with the accepted
Shortflare design language, and mixing the two systems would weaken component
consistency and ownership.

Retaining the original semantic CSS component layer was also rejected because
it creates two competing styling interfaces and prevents shadcn components from
being the common source-owned foundation. Managing each mutation form with
independent React state was rejected because it duplicates touched, validation,
submission, and error behavior across features.
