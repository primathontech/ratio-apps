# Make the google admin UI responsive — spec

- **Slug:** admin-responsive   **Type:** refactor (UI)   **Size:** small
- **Area:** admin (`apps/admin-google`) — frontend only, no backend

## Problem / goal
The `admin-google` SPA is desktop-oriented. It's already partly responsive (Navbar
mobile Drawer ≤720px, dashboard cards stack via `Col xs={24} md={8}`, `.container`
has a ≤600px padding query, config form is full-width vertical `Space`), but a few
spots break or get cramped on phones. Goal: every screen is usable down to **~360px
wide** with no unintended horizontal page scroll.

Confirmed gaps:
- **Dashboard cards uneven height** (`routes/index.tsx`) — GA4 / Google Ads / Merchant Center cards have different content lengths, so on desktop (3-across) they render at different heights and look ragged. They should be **equal height** (match the tallest) and stay clean when they stack on mobile.
- **Feed table** (`routes/feed.tsx`) has no horizontal scroll → 4 columns overflow the viewport on phones.
- **Filter `Select`** is fixed `width: 160` and sits next to other controls → can overflow / not wrap.
- **Install snippets** (`ScriptTagPanel.tsx`) render long URLs in `<Typography.Text code>` → can overflow horizontally.
- **Merchant Center stat tiles** (Synced/Warnings/Errors) + the **Force Sync / View Feed Details** button row can crowd or overflow on narrow cards.

## Approach
0. **Equal-height dashboard cards** — in `routes/index.tsx`, make the three cards in
   the `Row` fill their `Col` so they're all the tallest card's height: give each
   `Card` `style={{ height: '100%' }}` (antd `Col`s already stretch within a flex
   `Row`). On mobile (`xs={24}`, stacked) each is full-width — `height:100%` is a
   harmless no-op there. Result: even 3-across on desktop/tablet, clean stack on phone.
1. **Feed table** — add `scroll={{ x: 'max-content' }}` to the `Table` so it scrolls
   horizontally on narrow widths (decision: horizontal scroll, not card-stack). Make
   the filter `Select` full-width on small screens (e.g. `style={{ width: '100%', maxWidth: 220 }}`)
   and let the filter/controls row wrap.
2. **Install snippets** (`ScriptTagPanel.tsx`, google + `_template`) — ensure the
   code snippets wrap or scroll instead of overflowing: wrap each snippet in a block
   with `overflow-x: auto` / `word-break: break-all` so long URLs don't push the page.
3. **Dashboard / feed summary** (`routes/index.tsx`, `routes/feed.tsx`) — ensure the
   stat tiles and the action-button row use `flex-wrap: wrap` (and/or `Row`/`Col`) so
   they wrap on narrow cards instead of overflowing.
4. **Global** (`src/index.css`) — confirm no element forces width beyond the viewport;
   add a tablet breakpoint touch-up if needed; keep the existing 600px query.

No backend, no schema, no API changes. Behavior unchanged; layout-only.

## Acceptance criteria
- [ ] Dashboard GA4 / Google Ads / Merchant Center cards are **equal height** when shown 3-across (desktop/tablet) and stack cleanly full-width on mobile.
- [ ] Feed `Table` has `scroll={{ x: ... }}`; at ~360px the page itself does not scroll horizontally (only the table scrolls within its container).
- [ ] The feed filter `Select` is full-width / wraps on small screens (no fixed 160px overflow).
- [ ] Install-panel code snippets wrap or scroll within their card (no page-level horizontal overflow) on both google and `_template` ScriptTagPanel.
- [ ] Merchant Center stat tiles and the Force Sync / View Feed Details buttons wrap on narrow widths.
- [ ] Existing admin tests still pass; `pnpm verify` is green.
- [ ] Manual check (documented in the change journal): dashboard, config, feed, install all usable at 360 / 768 / 1280px with no broken layout.

## Out of scope
- Card-stack mobile renderer for the feed table (chose horizontal scroll).
- Any backend/API/schema change; new screens; visual redesign beyond responsiveness.
- Touching `_template` beyond the ScriptTagPanel snippet-overflow fix (it's reference-only / not built).

## Context consulted
- `apps/admin-google/src/{routes/index.tsx,routes/feed.tsx,routes/config.tsx,components/{Navbar,ScriptTagPanel}.tsx,index.css}` — current responsive state (Navbar Drawer ≤720px; dashboard `Col xs/md`; `.container` ≤600px query).
- `google` CONTEXT.md (admin built with @primathonos/orion = antd-based: `Row`/`Col` grid, `Table` `scroll`).
