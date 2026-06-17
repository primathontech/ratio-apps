# Make the google admin UI responsive — implementation plan
**Goal:** Every admin screen is usable down to ~360px with no page-level horizontal scroll, and the three dashboard cards render at equal height 3-across.
**Spec:** docs/agent/changes/admin-responsive/SPEC.md
**Execution:** inline (small, layout-only change across a few admin files; no cross-file coupling).

Note: this change is layout/CSS-only and has no behavioral test surface — the existing
admin tests (`index.test.tsx`, `feed.test.tsx`) must keep passing, and `pnpm verify`
is the gate. Manual responsive check at 360/768/1280px is recorded in the journal.

### Task 1: Equal-height dashboard cards
**Files:** Modify `apps/admin-google/src/routes/index.tsx`
- [ ] Add `style={{ height: '100%' }}` to each of the three `<Card>`s ("Google Analytics 4", "Google Ads", "Merchant Center") so they stretch to the tallest within the flex `Row`.
- [ ] Change the Merchant Center action `<Space>` (Force Sync / View Feed Details) to `<Space wrap>` so the buttons wrap on narrow cards.
- [ ] Run `pnpm --filter @ratio/admin-google test` — expect existing dashboard tests to PASS.

### Task 2: Feed table horizontal scroll + responsive filter
**Files:** Modify `apps/admin-google/src/routes/feed.tsx`
- [ ] Add `scroll={{ x: 'max-content' }}` to the `<Table>` so columns scroll within the card instead of overflowing the page.
- [ ] Change the filter `<Select>` `style={{ width: 160 }}` → `style={{ width: '100%', maxWidth: 220, minWidth: 140 }}`.
- [ ] Run `pnpm --filter @ratio/admin-google test` — expect PASS.

### Task 3: Install-snippet overflow (google + _template)
**Files:** Modify `apps/admin-google/src/components/ScriptTagPanel.tsx`, `apps/_template-admin/src/components/ScriptTagPanel.tsx`
- [ ] In both, add `style={{ wordBreak: 'break-all' }}` to the `<Typography.Text code>{scriptTag}</Typography.Text>` so the long SDK URL wraps instead of pushing the page wide.

### Task 4: Global viewport-overflow safeguard
**Files:** Modify `apps/admin-google/src/index.css`
- [ ] Add a defensive rule so inline `code` inside cards never forces width beyond the viewport (`word-break: break-word; white-space: normal;` scoped to `.ant-card-body .ant-typography code`), and confirm `.container` + body don't introduce horizontal overflow.

### Task 5: Verify + Definition of Done
- [ ] Run `pnpm verify` — expect green (lint + typecheck + test + build).
- [ ] Manual check at 360 / 768 / 1280px (dashboard equal-height cards, feed table scroll, install snippets, config) — record in the google CONTEXT.md journal.
- [ ] Record the change via `remember`; clear `PROGRESS.md`.
