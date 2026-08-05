# fbt — context

Living context for the FBT app ("Frequently Bought Together" — AI bundle
recommendations via OpenAI embeddings and cosine similarity). Read before
touching this module. Standing context first; dated change journal below
(newest first).

## Standing context

- **This is a greenfield migration, not an in-place one — and that reversal is
  the single most important fact about this app.** FBT is moving out of its own
  four-project repo (`osapp-freq-bought`: NestJS 10 + TypeORM, a second "ABS"
  sweep service, a Next.js admin, a Bun SDK) into `ratio-apps` as vendor slug
  `fbt`. The **first** design reused FBT's existing production database **in
  place**, additive-only, because the old backend had to keep serving live
  merchants from that schema during a parallel-run cutover. Two facts retired
  that constraint and produced this app's actual schema: **only 1–5 merchants
  are live** (so per-merchant cutover is trivial, not risky at scale), and the
  switch to `text-embedding-3-small` **already invalidates every cached
  vector** regardless of migration strategy. The user's ruling: nothing old
  transfers — merchants install the new Ratio app fresh and reconfigure by
  hand. Auto bundles regenerate on the first sweep; only manual bundles,
  widget styling, and exclusion lists need re-entry, a few hours of work at
  this merchant count. `fbt_app` is a fresh, empty database in every
  environment; the old FBT production database is never read, written, or
  migrated — kept read-only as reference until cutover, then decommissioned.

- **What greenfield deleted, and why it was deliberate, not laziness.** The
  in-place design needed a large amount of machinery that existed *solely* to
  make one database safe for two backends at once: a static additive-DDL guard
  (regex-checking every migration statement for anything destructive), an
  empirical schema verifier that ran migrations against a production-shaped
  fixture derived from the old repo's nine TypeORM migrations, a `merchants`
  backfill runbook with a `CRC32`-jittered `next_run_at` stagger (to avoid a
  thundering-herd of already-enabled merchants all becoming "due" the instant
  a column appeared), `information_schema` guards throughout `0001` to make
  every ALTER idempotent and resumable, and a destructive `0002` deferred to
  after decommission. **None of it is needed here and none of it should be
  reintroduced** — nothing shares this schema with anything else. If a future
  engineer proposes rebuilding any of these, the answer is that the two-backend
  constraint that justified them no longer exists.

- **Decisions a future reader would otherwise re-litigate:** No Shopify — no
  live Shopify merchants, and `core/oauth` speaks only Ratio (forking it per
  vendor is forbidden). No event map — FBT forwards no storefront events, so
  it ships no `fbt-events.ts` / `DEFAULT_FBT_EVENT_MAP` (the `wizzy` precedent).
  Every FBT-owned table is `fbt_`-prefixed with a real FK to `merchants` (the
  old schema had zero DB-level FKs) and **no `platform` column** anywhere (all
  merchants are OpenStore/Ratio). `fbt_merchant_config` is keyed on
  `merchantId` directly — no surrogate `id` — one row per merchant, matching
  `wizzy_configs`. Embeddings are stored as `embedding_blob` (`BLOB`, a raw
  `Float32Array`), never JSON: ~6 KB vs ~15–20 KB per row, and much cheaper to
  parse — this matters because cosine similarity runs in application code, so
  a sweep loads every embedding for the merchant. `allowAutomaticRecommendation`
  defaults **false** on install, so a new install spends no OpenAI budget until
  the merchant opts in. `nextRunAt = NULL` means "never opted in, not yet
  due" — the sweep's due-selection query **excludes** NULL rather than treating
  it as due; this is the opposite of what the old design needed (it had
  existing enabled merchants to catch up).

- **The four webhook topics are slash-delimited, plural, base-verb** —
  `app/uninstalled`, `products/create`, `products/update`, `products/delete` —
  confirmed against the platform's own webhook-events registry, not assumed.
  This is worth a paragraph because it is a proven failure mode, not a
  hypothetical one: `WebhooksService.dispatch` routes by **exact string match**
  and **silently no-ops** on a mismatch — a wrong topic never errors, the
  handler simply never fires. On the superseded `feat/fbt-foundation` branch
  all four topic values were wrong (dot-form: `app.uninstalled`, etc.), and
  that survived a fully green test suite and seven separate reviews, because
  every test asserted `handler.topic === FBT_TOPICS.X` — the constant compared
  to itself, proving only internal consistency. Only cross-checking against
  the platform's registry caught it. `test/unit/apps/fbt/topics.test.ts` on this branch
  therefore pins the **literal wire strings**, not the imported constant.
  `apps/backend/src/modules/_template/` still hardcodes the wrong dot-form
  (`'app.uninstalled'`) in its uninstall handler — do **not** copy it when
  scaffolding a future vendor from the template.

- **The schema guard (`test/unit/apps/fbt/schema-matches-types.test.ts`) is
  source-text analysis with a known, accepted limit.** It checks table
  existence, merchant foreign keys, and `merchant_id` width — deliberately
  **not** individual column types, `NOT NULL`, or defaults. The ruling: it
  isn't worth building a column-level source-text parser, because the guard
  only ever inspects `0001_initial.ts`, which is now applied and effectively
  frozen. Real future schema change lands in `0002`/`0003`, which this guard
  never reads — so a deeper column-level check on `0001` would protect a file
  nobody will edit again. Genuine forward protection requires comparing
  `FbtDatabase` against the *cumulative* live schema, which needs a DB-backed
  test harness this repo does not have. Don't approximate that with brittle
  parsing; build the real harness if this ever becomes a priority.

- **What Plans 2–6 own** (this app currently ships only the scaffold, schema,
  install seed, and inbound webhook handlers): **Plan 2** — bundles API +
  config/catalog/dashboard controllers. **Plan 3** — the recos engine:
  embeddings, similarity, the sweep, and the three sweep-outcome semantics
  (Complete / Incomplete / Failed — collapsing Incomplete into Complete would
  be a ~96× onboarding slowdown); this plan only *creates* the
  `fbt_sweep_lease` row-lease table, Plan 3 is the only consumer. **Plan 4** —
  the admin screens. **Plan 5** — `packages/fbt-sdk` (the storefront widget;
  contract-preserving rewrite of the existing deployed wrapper's counterpart).
  **Plan 6** — the per-merchant cutover.

- **Four carry-forwards later plans must not lose:**
  1. **The toggle-on contract.** Enabling `allowAutomaticRecommendation` must
     set `nextRunAt = NOW(3)` in the *same write*. `fbt.bootstrap.ts`'s
     docstring and the spec both commit to this; Plan 2's config controller
     must implement it as one atomic update, not flip the boolean and leave
     scheduling stale.
  2. **The admin scaffold describes the wrong install mechanism.**
     `ScriptTagPanel.tsx`, `routes/install.tsx`, and `routes/config.tsx` are
     inherited `_template` content about pasting a `<script>` tag and a
     PostHog-style API-key form. FBT's real model is an already-deployed
     storefront wrapper fetching `/fbt/sdk/config/:merchantId` — nothing to
     paste. Plan 4 must **gut and rewrite** these, not adapt them.
  3. **An unresolved admin session seam, inherited from `_template` and shared
     by every scaffolded vendor** (confirmed present verbatim in google, meta,
     loyalty, posthog, moengage, and fbt's own OAuth controllers): the install
     callback sets an HttpOnly cookie and redirects to the admin root with
     **no query string**, and the controller's own docstring says
     `TODO admin: read /install/session on root mount`. But
     `admin-fbt/src/lib/session.ts` only reads `?merchant-id=`, localStorage,
     or a dashboard `postMessage` — it never calls that endpoint. Plan 4 must
     decide: finish the `install/session` path, or delete it as dead code and
     commit to the iframe/`postMessage` route.
  4. **`previewBaseUrl` is a nullable column and schema field nothing writes
     yet.** Plan 2 must decide whether it is merchant-editable in the admin or
     derived from the Ratio merchant record.

## Change journal

### 2026-08-05 — feature — Plan 1 of 6: greenfield foundation (scaffold, schema, install, webhooks)
- **What:** Stood up `fbt` as a wired, installable vendor app: scaffolded from
  `_template` (backend module + `apps/admin-fbt`); the real 9-table
  `FbtDatabase` and `packages/shared/src/schemas/fbt-config.ts`; the greenfield
  `0001_initial.ts` migration (six `fbt_`-prefixed tables + the three shared
  tables, no additive machinery); `FbtBootstrap` seeding one
  `fbt_merchant_config` row per install (reinstall-safe via
  `ON DUPLICATE KEY UPDATE` with a self-referencing no-op); and the four
  inbound webhook handlers (`app/uninstalled`, `products/{create,update,delete}`)
  with product-embedding/similarity-cache invalidation on product change.
  `packages/fbt-sdk` (the storefront SDK) is deliberately **not** created here
  — see Plan 5 above.
- **Why:** Supersedes branch `feat/fbt-foundation` (20 commits, in-place/
  additive design), retired by the spec's Revision 1 once only 1–5 merchants
  turned out to be live and the embedding-model switch was going to invalidate
  every cached vector regardless.
- **Definition of done / fix:** All 5 tasks complete, each independently
  reviewed (0 Critical, 0 Important across every per-task review). The
  whole-branch review found the code itself clean and raised only this
  documentation gap — the plan's own Definition of Done items 2–5 (this file,
  the `FEATURES.md` row, durable-decisions records, `PROGRESS.md`) had not
  been carried out, which mattered more than usual here because
  `docs/superpowers/` and `.superpowers/` are both gitignored: without this
  file, the entire reasoning behind deleting the additive-safety machinery
  would have vanished from the repo on merge.
- **Files:** `apps/backend/src/modules/fbt/**`, `apps/admin-fbt/**`,
  `packages/shared/src/schemas/fbt-config.ts`,
  `apps/backend/test/unit/apps/fbt/**`, `apps/backend/src/config/apps.ts`,
  `apps/backend/src/module-registry.ts`, `docker/mysql/init/01-database.sql`,
  `.env.example`, root `package.json` (5 scripts).
- **Links:** spec `docs/superpowers/specs/2026-08-03-fbt-monorepo-migration-design.md`
  (Revision 1 + §7); plan
  `docs/superpowers/plans/2026-08-05-fbt-01-foundation-greenfield.md`; ADR
  [0006](../../context/decisions/0006-fbt-greenfield-schema-over-in-place.md).
