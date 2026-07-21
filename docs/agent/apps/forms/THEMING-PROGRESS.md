# Form Builder rich-theming — build loop progress

Goal: make embedded forms look professional/on-brand (not "vague"). Autonomous
loop: design → build → verify → critique → next round, until critique says
`professional: true`. All work on `feat/form-builder` in this worktree.

Spec: `docs/agent/apps/forms/THEMING-SPEC.md`

## Rounds
- **Design** — done. wf_ed535e42-b8b. Produced THEMING-SPEC.md.
- **Round 1 (P0)** — done, workspace GREEN, widget 11.72 KB. wf_78cc5339-7a6.
  Shipped: appearance token schema (colors/typography/layout), themeVars wiring,
  focus ring, host style-bleed guard, radio/checkbox/number fields, Design tab
  with color pickers + WCAG contrast, FormPreview.
  Critique verdict: NOT professional — naked embed (no card/heading, dead bg),
  inert font picker, no presets, no hover/error states.
- **Round 2 (P1)** — done, GREEN, widget 13.27 KB. wf_28856925-9a0.
  critique: professional=TRUE. Shipped: themed card+heading, web fonts, presets,
  hover/error states, themed ending+redirect, responsive, url/rating/hidden.
  Remaining: live --wz-subtle dark-theme bug + admin-preview/SDK-embed drift.
- **Round 3 (consistency)** — done, GREEN, widget 13.54 KB. wf_b51933dc-023.
  critique: professional=TRUE. Fixed dark-theme --wz-subtle (status boxes + phone
  chip now color-mix themed, no baked grays). Admin FormPreview now embeds the
  REAL <ratio-form> element via ?sdk import + inline preview props — dual-renderer
  drift killed. previewMatchesEmbed=false only due to 2 unforwarded strings.
- **Round 4 (final polish)** — DONE, GREEN, widget 13.55 KB brotli.
  Forwarded successMessage + submitLabel into preview. Preview is now
  content-identical to embed. Tests: sdk 81, admin 69 passing.

## STATUS: core "doesn't look vague" bar MET.
professional=TRUE, previewMatchesEmbed=TRUE (content-identical). All on
feat/form-builder, workspace green, widget under 16 KB budget.

## Optional future (NOT auto-looped — scope choices, not vague-fixes)
Multi-step/paged forms + progress bar; scale/NPS, address, signature fields;
cover-image cropping/polish; remove-branding toggle; raw custom-CSS (P2, only
behind an AST allowlist per spec §2.5).

## Aside (dashboard flow — separate from this loop)
Dashboard/tunnel work is paused; cloudflared quick-tunnels die every restart.
Local dev needs no tunnel. Forms backend runs on :3001 (worktree
apps/backend/.env), delhivery on :3000 (main repo, untouched).

## Visual-controls expansion (post-professional feature work)
- Layout+bg build — wf_c9938272-4e9 (RUNNING): page background, half-width
  side-by-side fields, button alignment. Resume: resumeFromRunId wf_c9938272-4e9.
- Visual-control research — wf_86619ef5-05b (DONE). Catalog at
  docs/agent/apps/forms/VISUAL-CONTROLS-CATALOG.md.
- Tier-1 build — wf_e6cf221d-5a0 (RUNNING). Resume: resumeFromRunId wf_e6cf221d-5a0.
  the catalog — input variants, page bg gradient/image+scrim, content blocks
  (heading/divider/paragraph/image), floating labels, focus-ring+motion, button
  size+icon, required-mark, field-spacing. All no-migration, default=today.
  Then Tier-2. REMINDER: after any schema change, run
  `pnpm --filter @ratio-app/backend exec tsx scripts/migrate.ts forms` only if a
  migration file was added (Tier-1 adds none — pure JSON-column keys).

## Visual-controls Tier progress
- Tier-1 build wf_e6cf221d-5a0 DONE (green, professional). 4 critique issues then
  fixed in wf_ee14e26b-bb9 DONE (green, all resolved, widget 15.97 KB).
- Widget size budget RAISED 16 KB -> 32 KB (.size-limit.json) per user decision.
- Tier-2 build wf_bbc93879-12b RUNNING: multi-column, per-field style override,
  adornments (prefix/suffix/help/counter), micro-animations, frosted-card blur.
  Resume: resumeFromRunId wf_bbc93879-12b.
- Tier-3 (raw CSS / video bg / custom-font upload) = deferred by design (security).
- After Tier-2 lands green: rebuild bundle (VITE_API_BASE_URL=<tunnel>), re-zip to
  ~/Desktop/forms-admin.zip, ready for dashboard redeploy.

- Tier-2 build wf_bbc93879-12b DONE (green, professional, widget 17.36 KB). Critique
  found adornment/counter admin-vs-SDK gating drift + floating/prefix overlap.
- Tier-2 fixes wf_bd258fbc-dd1 DONE (green, all resolved). Introduced shared
  capability sets (form-adornments.ts): FORM_ADORNABLE_FIELD_TYPES,
  FORM_COUNTER_FIELD_TYPES — both admin + SDK consume them (single source of truth).
  Widget ~17-19 KB (<32 KB budget). vite.config alias added for the ?sdk embed.

## STATUS: visual-control expansion COMPLETE (Tier 1 + Tier 2). Tier 3 deferred (security).
Next optional: redeploy to dashboard (needs fresh tunnel after restart) or commit.

## Enrichment PR build (per PRD-ENRICHMENT.md + FIELD-ENRICHMENT-PLAN.md + THEMING-SECTION-CATALOG.md)
Committed baseline: a32fd2c (visual-control expansion). All build docs in this dir.
- Exhaustive PRD: PRD-ENRICHMENT.md (1419 lines) — coverage cross-checked complete
  (15/15 fields, 12/12 theming sections, migrations, tokens, a11y fixes). Fine-grained
  LLM audit still owed (blocked by API 529 at time of writing).
- Phase 0 module refactor: wf_e4ac7b7f-607 RUNNING (test-locked no-op → per-field modules
  + registries). Resume: resumeFromRunId wf_e4ac7b7f-607.
- NEXT after Phase 0 green: Phase 1 security/hardening pass; Phase 2 P0 enrichment field
  batches (parallel per-field, now conflict-free thanks to modules); Phase 3 structural
  (file multi-file reshape; hidden context_json = the ONE new migration); Phase 4 P1/P2.
  Plus theming-section P0 wave (THEMING-SECTION-CATALOG.md).
- NOTE: API 529 overload may throttle multi-agent waves; verify/fix loops + git baseline
  absorb transient failures. Run migrate.ts forms only when a migration file is added.
