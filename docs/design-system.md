# Shortflare Design System

Status: Foundation accepted

Locked identity decisions:

- `Flare` red is Shortflare's permanent brand and action color.
- Accessibility is a token-level requirement, not a final visual check.

## Design read

Shortflare is a self-hosted link operations tool for an Owner and a small,
invite-only group of Users. It should feel calm, exact, and fast without looking
like generic enterprise software.

The visual idea is **quiet infrastructure, bright action**:

- the work surface stays neutral so Links and analytics remain easy to scan;
- color appears when it communicates action, state, selection, or risk;
- information is dense enough for daily work but never compressed into a
  cockpit;
- every mutation makes its target and consequence obvious.

Design dials:

| Dial | Value | Meaning |
| --- | ---: | --- |
| Design variance | 4/10 | Ordered grids with occasional asymmetric detail views |
| Motion intensity | 3/10 | Tactile feedback and state transitions only |
| Visual density | 7/10 | Compact operations with deliberate breathing room |

## Product character

### Calm

The interface should disappear behind the task. Large decorative surfaces,
gradients, glass effects, and ornamental motion are not part of the product
language.

### Exact

Aliases, states, revisions, time ranges, and destructive consequences are
presented explicitly. The UI never relies on color alone and never hides
important state behind hover.

### Owned

An Instance belongs to its Owner. The product should feel like a dependable
tool installed in the Owner's infrastructure, not a sales surface or a shared
social product.

### Quick

Frequent actions stay near the object they affect. Creating a Link, copying its
short URL, filtering the collection, and reading its state should require
minimal travel.

## Interface principles

### 1. Alias first

The Alias is the stable identity of a Link. In every Link representation, show
the Alias or server-derived short URL before the current Destination.

Recommended hierarchy:

1. title, when present;
2. short URL with the Alias emphasized;
3. current Destination;
4. state, Human Clicks, and updated time.

### 2. State is text plus shape

Active, Disabled, and Archived are domain states, not decoration. Each state
uses a stable label, icon, and tone. Never communicate state with a colored dot
alone.

### 3. Density is progressive

Collections use compact rows. Secondary metadata appears in a detail panel or
expanded row. Full cards are reserved for analytics modules and empty states
where containment adds meaning.

### 4. Actions stay with their object

Copy, edit, disable, archive, and restore belong to the Link row or Link detail
header. Global controls are limited to create, search, filter, and collection
display settings.

### 5. Risk interrupts speed

Reversible commands can be quick. Permanent deletion, Reserved Alias release,
role changes, and password resets require a clear confirmation surface that
names the target and consequence.

### 6. Analytics answers one question at a time

Every chart has a question-shaped title, one primary measure, a visible date
range, and a textual fallback. Avoid dashboards made from equally weighted
tiles.

## Foundations

### Color

The core palette combines mineral neutrals with one warm action color named
`Flare`. Flare red is a brand constant. Future themes may adjust its luminance
to preserve contrast, but must not replace its hue with another accent family.

#### Light theme

| Token | Value | Use |
| --- | --- | --- |
| `--color-canvas` | `#F5F7F6` | App background |
| `--color-surface` | `#FFFFFF` | Primary work surface |
| `--color-surface-subtle` | `#EEF2F0` | Selected rows, quiet grouping |
| `--color-surface-raised` | `#FBFCFB` | Popovers and dialogs |
| `--color-ink` | `#17211F` | Primary text |
| `--color-ink-secondary` | `#4F5D59` | Supporting text |
| `--color-ink-muted` | `#65716D` | Metadata |
| `--color-border` | `#D8DFDC` | Default boundary |
| `--color-border-strong` | `#7B8984` | Input and active boundary |
| `--color-flare` | `#B83A22` | Primary action and selection |
| `--color-flare-hover` | `#962E1B` | Primary action hover |
| `--color-flare-soft` | `#F9E8E3` | Selected or highlighted background |
| `--color-focus` | `#E35B3E` | Focus ring |

#### Dark theme

| Token | Value | Use |
| --- | --- | --- |
| `--color-canvas` | `#111614` | App background |
| `--color-surface` | `#18201D` | Primary work surface |
| `--color-surface-subtle` | `#202A26` | Selected rows, quiet grouping |
| `--color-surface-raised` | `#26312D` | Popovers and dialogs |
| `--color-ink` | `#F1F5F3` | Primary text |
| `--color-ink-secondary` | `#BAC5C1` | Supporting text |
| `--color-ink-muted` | `#8F9D98` | Metadata |
| `--color-border` | `#35423D` | Default boundary |
| `--color-border-strong` | `#6E8079` | Input and active boundary |
| `--color-flare` | `#F06A4C` | Primary action and selection |
| `--color-flare-hover` | `#FF8064` | Primary action hover |
| `--color-flare-soft` | `#41241D` | Selected or highlighted background |
| `--color-focus` | `#FF8D73` | Focus ring |

Semantic colors are separate from the brand accent because they communicate
domain meaning. These pairs are indivisible tokens. Do not use a foreground
with a different soft background without measuring the new combination.

#### Light semantic pairs

| Meaning | Foreground | Soft background | Contrast |
| --- | --- | --- | ---: |
| Success or Active | `#176B4D` | `#E4F3EC` | 5.65:1 |
| Warning | `#8A5A00` | `#FAEFCF` | 5.17:1 |
| Danger | `#A22B22` | `#FAE7E5` | 6.07:1 |
| Information | `#315F78` | `#E5F0F5` | 5.96:1 |
| Neutral or Disabled | `#596560` | `#E9EEEC` | 5.18:1 |
| Archived | `#665C74` | `#EEEAF2` | 5.28:1 |

#### Dark semantic pairs

| Meaning | Foreground | Soft background | Contrast |
| --- | --- | --- | ---: |
| Success or Active | `#78D6AD` | `#173A2D` | 7.16:1 |
| Warning | `#F4C66A` | `#3B2E13` | 8.28:1 |
| Danger | `#FF9B91` | `#461E1B` | 7.08:1 |
| Information | `#8FCBE8` | `#19313D` | 7.67:1 |
| Neutral or Disabled | `#B9C5C0` | `#28322E` | 7.45:1 |
| Archived | `#CDB9DC` | `#33283C` | 7.66:1 |

#### Contrast contract

Shortflare targets WCAG 2.2 AA as its minimum:

- normal text below 24px, or below 18.66px when bold: at least 4.5:1;
- large text at or above those thresholds: at least 3:1;
- focus indicators, control boundaries, selected states, and meaningful chart
  graphics: at least 3:1 against adjacent colors;
- disabled controls may use the standard's exception, but their labels should
  remain readable whenever practical;
- logos are not used as a reason to weaken nearby text contrast.

Approved Flare pairs:

| Use | Foreground | Background | Contrast |
| --- | --- | --- | ---: |
| Light primary button | `#FFFFFF` | `#B83A22` | 5.73:1 |
| Light selected text | `#B83A22` | `#F9E8E3` | 4.82:1 |
| Light focus ring | `#E35B3E` | `#FFFFFF` | 3.60:1 |
| Light strong boundary | `#7B8984` | `#FFFFFF` | 3.65:1 |
| Dark primary button | `#111614` | `#F06A4C` | 5.98:1 |
| Dark selected text | `#F06A4C` | `#41241D` | 4.60:1 |
| Dark focus ring | `#FF8D73` | `#18201D` | 7.37:1 |
| Dark strong boundary | `#6E8079` | `#18201D` | 3.98:1 |

Do not infer accessible variants by opacity. Disabled, hover, focus, selected,
and chart states each require measurement against their actual composited
background. Any new color token must record at least one approved foreground
and background pairing with its measured ratio.

Charts may use a small categorical palette. Chart colors never become button
or navigation colors.

### Typography

Use one sans family and one mono companion:

- UI and headings: `Geist Sans`, self-hosted with `font-display: swap`;
- Aliases, URLs, numbers, and revisions: `Geist Mono`;
- fallback: system sans and system mono.

The product uses sentence case. Uppercase labels with wide tracking are not part
of the system.

| Role | Size / line height | Weight |
| --- | --- | --- |
| Page title | `28 / 34` | 650 |
| Section title | `20 / 26` | 650 |
| Component title | `16 / 22` | 600 |
| Body | `14 / 21` | 400 |
| Label | `13 / 18` | 600 |
| Metadata | `12 / 17` | 450 |
| Data value | `24 / 28` | 650 |

Use tabular numerals for analytics, dates, counts, and revisions.

### Spacing

The base unit is 4px.

| Token | Value |
| --- | ---: |
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 20px |
| `--space-6` | 24px |
| `--space-8` | 32px |
| `--space-10` | 40px |
| `--space-12` | 48px |

Default relationships:

- icon to label: 8px;
- label to control: 8px;
- control to helper or error: 6px;
- related controls: 12px;
- component groups: 24px;
- page sections: 40px.

### Shape

Shape follows scale:

| Token | Value | Use |
| --- | ---: | --- |
| `--radius-control` | 7px | Inputs, buttons, chips |
| `--radius-panel` | 11px | Panels, popovers, chart modules |
| `--radius-dialog` | 15px | Dialogs and large empty states |

Pills are reserved for status chips and segmented selections. Rows do not float
inside rounded cards.

### Borders and elevation

Borders establish most hierarchy. Shadows are reserved for content that sits
above the document:

- inline panels: border only;
- sticky command bars: border plus a subtle canvas-colored shadow;
- popovers: one border and one short shadow;
- dialogs: backdrop plus one broad, low-opacity shadow.

### Icons

Use one outlined icon family at 1.75px stroke weight. Default sizes are 16px for
inline actions, 18px for controls, and 20px for navigation. Icons always have an
accessible name when no text label is visible.

## Layout system

### App shell

Desktop uses a two-part shell:

- a 216px navigation rail that may collapse to 64px;
- a fluid work area capped at 1440px for content, while the canvas may extend
  edge to edge.

The rail contains Links, Analytics, Users, and Instance settings according to
the User's role. The create action belongs in the work-area command bar, not in
the navigation rail.

At widths below 768px:

- navigation becomes a top bar plus a modal menu;
- page controls wrap into two intentional rows;
- Link rows become stacked scan blocks;
- detail panels become full-screen sheets.

### Page header

A page header contains:

1. title and optional one-line description;
2. primary action;
3. a separate command row for search, filters, date range, and view controls.

Avoid combining navigation, page identity, search, and creation into one crowded
toolbar.

### Content grid

Use a 12-column grid above 1024px, 8 columns from 768px to 1023px, and a single
column below 768px. The standard gap is 24px.

Analytics pages use a deliberate hierarchy:

- one primary chart spans 8 columns;
- its supporting summary spans 4 columns;
- secondary breakdowns follow below;
- metric values can sit in one unboxed summary strip above the charts.

## Core patterns

### Link row

The Link row is the central Shortflare component.

Desktop anatomy:

```text
[state] [title or Alias                       ] [Human Clicks] [updated] [actions]
        [short URL] -> [current Destination  ]
```

Rules:

- default height is 68px;
- the Alias or short URL is always visible;
- long Destinations truncate in the middle and reveal the full value on focus or
  in the detail panel;
- the copy action remains visible;
- secondary actions appear in a menu, but the menu trigger remains visible;
- row selection uses a soft Flare background and a 2px inset marker;
- archived rows are available only when the collection filter includes them.

Mobile anatomy:

```text
[state label]                  [actions]
[title or Alias]
[short URL] [copy]
[Destination]
[Human Clicks] [updated]
```

### Link detail

Open Link detail in the main work area on wide screens and as a full-screen
sheet on narrow screens. Preserve collection filters and scroll position when
closing it.

Sections appear in this order:

1. identity and state;
2. current Destination;
3. analytics summary;
4. Destination Versions;
5. administrative commands.

The current revision stays implementation metadata until a conflict occurs.

### Status chip

A status chip includes an icon and a text label:

- Active: check-circle icon;
- Disabled: pause-circle icon;
- Archived: archive icon;
- Invited User: mail icon;
- Active User: check-circle icon;
- Suspended User: lock icon.

Status chips are compact, soft-filled, and never interactive unless paired with
a visible disclosure icon.

### Command bar

The command bar provides search, filters, date range, and display density.
Applied filters render as removable controls below the inputs rather than inside
the search field.

On scroll, the command bar may become sticky after the page title leaves the
viewport. It must retain the same height to prevent layout shift.

### Buttons

| Variant | Use |
| --- | --- |
| Primary | One page-level or dialog-level action |
| Secondary | Common alternative action |
| Quiet | Row actions and toolbar utilities |
| Danger | Confirmed destructive action only |

Button height is 36px by default and 40px for authentication and large dialogs.
Buttons move down 1px on press. Loading preserves the original label width.

### Forms

Labels sit above fields. Helper text is optional and error text appears directly
below the field. Placeholder text never replaces a label.

URL and Alias fields use mono text for the value, but their labels and helper
text remain sans.

For Link creation:

- Destination is first;
- generated Alias is the default;
- custom Alias is a progressive option;
- the resulting short URL is shown before submission when it can be derived.

### Panels and cards

Use panels only when content has its own controls or reading context. A chart
module is a panel. A collection row is not.

Panel header anatomy:

```text
[question-shaped title] [range or scope] [panel actions]
```

### Feedback

- validation errors are inline;
- transport failures are contextual banners close to the affected collection;
- successful copy uses a transient label change from `Copy` to `Copied`;
- successful mutations update the object in place;
- background or delayed work may use a toast;
- permanent outcomes are never communicated by toast alone.

### Empty and loading states

Loading uses skeletons matching the final row or chart shape. Avoid generic
spinners for initial page loads.

Empty states are compact and factual:

- no Links: explain the first Link and offer `Create Link`;
- no filter results: preserve filters and offer `Clear filters`;
- no analytics: explain that data appears after Human Clicks are recorded;
- no Users: only possible before the initial Administrator is active.

### Conflict state

When a mutation fails because the Link revision is stale:

1. keep the User's submitted values;
2. fetch and show the current Link;
3. identify which fields changed;
4. offer `Review changes` and `Discard mine`;
5. never merge or retry automatically.

### Destructive confirmation

Permanent deletion and Reserved Alias release require the exact Alias as
confirmation. The dialog:

- names the target in mono text;
- explains whether the Alias remains reserved or becomes reusable;
- lists retained and removed data;
- keeps the danger action disabled until the exact Alias matches;
- places cancel first in keyboard order and focuses it by default.

## Analytics language

The default analytics view prioritizes:

1. Human Clicks over time;
2. Unique Human Clicks, clearly described as approximate;
3. top Links;
4. referrers;
5. countries and devices when supported.

Chart rules:

- primary time series uses the Flare color;
- suspected bots are excluded by default and the scope is visible;
- every chart supports a readable table representation;
- legends use direct labels where possible;
- zero is included for count charts unless a clear analytical reason says
  otherwise;
- tooltips are keyboard reachable;
- color is never the only series differentiator.

## Motion

Motion communicates feedback or state change:

| Duration | Use |
| --- | --- |
| 120ms | Hover, press, focus |
| 180ms | Popover, menu, tooltip |
| 240ms | Sheet, dialog, row expansion |

Use an ease-out curve for entering and a slightly faster ease-in curve for
leaving. Animate opacity and transform only. Under reduced motion, remove
movement and keep instant opacity changes.

No perpetual animation, parallax, scroll hijacking, or decorative shimmer is
part of the management UI.

## Content design

Use the domain language in `CONTEXT.md` exactly:

- Instance, not workspace or tenant;
- User, not account;
- Administrator, not admin;
- Link, not short URL when naming the domain object;
- Alias, not slug or short code;
- Destination Version, not destination history;
- Human Click, not visit;
- Reserved Alias, not tombstone.

Labels use direct verbs:

- `Create Link`
- `Copy short URL`
- `Edit Link`
- `Disable Link`
- `Archive Link`
- `Restore Link`
- `Permanently delete`
- `Release Alias`

Avoid promotional language inside the management UI. Confirmation text states
the consequence rather than trying to sound reassuring.

## Accessibility contract

- body text and controls meet the contrast contract defined with the color
  tokens;
- visible focus is a 2px ring with 2px offset;
- every action is keyboard reachable;
- row menus do not make the row itself a nested interactive target;
- touch targets are at least 44px on mobile;
- charts expose summaries and tabular data;
- validation associates messages through `aria-describedby`;
- dialogs trap focus, restore focus on close, and have a visible title;
- live regions are reserved for copy confirmation and mutation results;
- theme selection respects system preference and can be overridden.

## What Shortflare does not use

- blue or violet as a default action accent;
- gradients in product chrome;
- floating glass panels;
- a card around every group;
- colored dots without labels;
- centered dashboard headings;
- full-page animation;
- multiple competing type families;
- uppercase tracking labels;
- icon-only destructive actions;
- hidden state that appears only on hover;
- automatic retries for mutations.

## Implementation boundary

The system should be implemented as semantic CSS custom properties and owned
React components inside `apps/management`. Component behavior may use accessible
headless primitives, but the visual layer remains Shortflare-owned.

Suggested first implementation slice:

1. foundation tokens and theme root;
2. Button, Field, StatusChip, and Banner;
3. AppShell and PageHeader;
4. LinkRow, CommandBar, and Link detail sheet;
5. Dialog and destructive confirmation;
6. Metric summary and chart panel;
7. authentication and User management migration.

## Design review checklist

- Is the Alias more prominent than the Destination?
- Can every Link state be understood without color?
- Is there only one primary action in the current scope?
- Are collection rows used instead of decorative cards?
- Does every destructive action name its exact target and consequence?
- Are loading, empty, error, success, and conflict states designed?
- Does mobile preserve the same task order?
- Does reduced motion preserve all meaning?
- Are domain terms consistent with `CONTEXT.md`?
- Does any styling resemble generic SaaS decoration rather than Shortflare?
