---
status: accepted
---

# Own UI components through shadcn and Base UI

Use shadcn/ui's `base-nova` style as the source-owned component layer, Base UI
as its accessible behavior primitive, Tailwind CSS as the token-aware styling
engine, and Lucide React as the single outlined icon family. This combination
keeps Shortflare's exact brand, density, state, and contrast rules in repository
code while delegating complex interaction behavior to accessible primitives.

Astryx was considered but is not adopted or retained as a future candidate. Its
separate component and theming system would compete with the accepted
Shortflare design language, and mixing the two systems would weaken component
consistency and ownership.
