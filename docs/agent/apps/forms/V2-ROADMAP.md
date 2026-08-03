# Ratio Forms — v2 Roadmap (consolidated gap analysis)

**Date:** 2026-07-25. Source: two evidence-based gap analyses (functional + theming) verified against code.
Supersedes the stale `FUNCTIONALITY-PUNCHLIST.md` (see "Punchlist reconciliation" below).

## Status at a glance

| Layer | Status |
|---|---|
| v1 core PRD (`PRD.md`) | ✅ DONE end-to-end |
| Enrichment §3 foundation (appearance tokens, 18 fields + per-field refactor, 6 presets, Design tab, WYSIWYG preview, migrations 0003/0004) | ✅ DONE |
| v2 · §4 per-field depth (`PRD-ENRICHMENT.md` §4) | ~25% — mostly MISSING |
| v2 · §5 theming P0/P1 (`THEMING-SPEC`, Controls Tier 1–2) | ✅ shipped end-to-end |
| v2 · §5 theming enrichment (12-section `THEMING-SECTION-CATALOG`) | ~55% overall — paused after shared-primitives, largely unbuilt |

**No admin↔renderer parity drift**: the admin live preview embeds the real `<ratio-form>` SDK renderer (`FormPreview.tsx`), so every shipped control is honored. New items build once (schema + renderer + admin).

## Punchlist reconciliation (already fixed, not reflected in the old punchlist)
RE2 ReDoS fix (`fields/text/regex-engine.ts`), number-`step` server enforce, strict date-ISO, multi_select cap/dedup, reserved CSV keys — all DONE in code.

---

## Batch plan (cheapest / highest-leverage first)

### Batch 1 — Correctness & a11y sweep  ← IN PROGRESS
Renderer/security/a11y, near-free, all testable. (Exact OPEN vs already-done being verified before edits.)
- I1 autofill styling fix (renderer)
- B2 submit loading spinner + `aria-busy`/`aria-disabled` (renderer) — current `disabled` drops keyboard focus (WCAG)
- A1/A2 live-region announce + focus-first-invalid + error summary (renderer)
- B3 44px touch-target floor (renderer)
- A8 `@media forced-colors` + universal `:focus-visible` (renderer)
- P2-7 group accessible names — `<fieldset>/<legend>` or `role=group`+`aria-labelledby` on radio/multi_select/rating
- P2-8 `aria-invalid`/`aria-describedby` on checkbox + file fields
- P2-1 fail-closed postMessage origin (`admin-forms/src/lib/session.ts`)
- P2-2 file-field submit value re-check (`submissions/fields/file/validate.ts`, `schema-validator.service.ts`)
- P2-3 upload magic-byte content-type sniff (`uploads/uploads.controller.ts`, `s3.service.ts`)

### Batch 2 — Zero-config field wins (S)
- `url` `validation{requireHttps, maxLength}` + bare-domain normalize (field has zero config today)
- `date` `validation{min,max}` + `defaultTo` (server ISO already done)
- `rating` `lowLabel/highLabel` + numbered-button display + 0-based `min` (unlocks NPS/opinion scale)

### Batch 3 — Shared keystones (M–L, unblock many)
- **Option-object model** (value≠label, defaultValue, bulk-paste, searchable, `.max(200)`+dedupe) → unblocks dropdown/radio/multi_select rich options. `optionValues()` server one-liner.
- **Theming Wave-0 substrate**: `--wz-fs-*` typography role tokens, per-state color engine (named `--wz-primary-active/-soft`, `--wz-error-bg/-ring`), motion set `--wz-dur-*`, `.rf-bg` filter layer, named container. Prerequisite for most of §5.

### Batch 4 — Field depth (S–M each, parallel after Batch 3)
- text: hard `maxLength.max(1000)` ceiling + `transform` + `autocomplete` + format presets
- multi_select: `selection{min,max}` + display mode + columns + select-all (server cap done)
- checkbox: `consentText` + `{link}` tokens + multi-link
- number: display `format{style,currency,grouping,decimals}` (Intl)
- email: `validation{maxLength, normalize, blockFreeProviders, allowed/blockedDomains}`
- phone: multi-country dial-code + per-country meta
- hidden: `fallback` + multi-source `source` enum
- content blocks (heading/divider/paragraph/image) appearance keys + CSV phantom-column filter (P2-10)

### Batch 5 — Visual payoff theming (S–M)
- B1 button variant solid/outline/ghost/soft
- Layout: inputPadX, cardPadding (fix override bug), contentAlign, card/flat, fluidWidth
- Color per-state/semantic: `success/link/placeholder` + named state tokens
- Typography T1/T2/T4: heading/body pairing + type-scale ratio + line-height
- Focus/motion: focusOffset, motionSpeed scale + easing, submit spinner
- Background: image brightness/blur/grayscale + shadow lg/xl

### Batch 6 — Structured features (M)
- **Ending states** `appearance.endings`: structured themed panel (icon+heading+body), per-state copy (closed/expired/unavailable/error), redirect delay + countdown. Back-compat chain to `successMessage`.
- Branding: logo size/align/alt + cover overlay/height/blur, powered-by toggle
- Presets: expand 6→~20 + categories + export/import JSON (admin-only, zero renderer risk)

### Batch 7 — Structural workstreams (L)
- `file` **multi-file**: `files_json` `string → string[]` reshape across list/detail/webhook/CSV/SDK + preview/dropzone/progress
- `hidden` provenance `context_json` — the only new DB migration (`0005`)

### Deferred (P2/Tier-3, out of scope for now)
Dark mode (`colorScheme` + `colorsDark`), RTL `dir`/`lang`, multi-step/pages engine + progress bar, raw custom CSS (AST-allowlist), video backgrounds, custom-font upload, APCA contrast tiers.

---

## Rough completion
- Functional v2 (§4): ~25%.
- Theming (§5 spec P0/P1): shipped; theming enrichment catalog: ~55% overall.
- Critical path: Batch 3 keystones unblock Batches 4–6; Batch 7 items are isolated.
