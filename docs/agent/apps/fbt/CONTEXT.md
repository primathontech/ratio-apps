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
  1. ~~**The toggle-on contract.**~~ **RESOLVED 2026-08-05 in Plan 2** —
     implemented in `apps/backend/src/modules/fbt/config/config.service.ts`.
     The semantics that shipped, which Plan 3's sweep depends on: off→on sets
     `nextRunAt = now` in the *same* update as the boolean; on→off sets it to
     `NULL` so a later re-enable starts fresh rather than inheriting a stale
     past timestamp that fires immediately; and an **unchanged** toggle leaves
     `nextRunAt` absent from the update entirely, so repeatedly saving unrelated
     fields cannot be used to jump the sweep queue. Six tests pin these three
     branches, and the reviewer confirmed each would fail under the
     corresponding broken behaviour.
  2. ~~**The admin scaffold describes the wrong install mechanism.**~~
     **RESOLVED 2026-08-05** — the PostHog-shaped scaffold content is deleted,
     not deferred. See the journal entry below. The replacement route skeleton
     mirrors the source admin, and `Navbar.test.tsx` pins the five screens so a
     future scaffold refresh cannot reintroduce Config/Events/Install.
     Parity is now tracked in [PARITY.md](./PARITY.md), which is the checklist
     Plans 2–5 close out.
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
  4. ~~**`previewBaseUrl` is a nullable column and schema field nothing writes
     yet.**~~ **RESOLVED 2026-08-05 in Plan 2** — merchant-editable via the
     config `PUT`, not derived from the Ratio merchant record. It is already in
     `fbtMerchantConfigSchema` (validated as a URL, nullable), and
     `FbtConfigService.upsert` writes it like any other field.
  5. ~~**`fbt_merchant_config.ui_config` exists in the DDL but is missing from
     `fbtMerchantConfigSchema`.**~~ **RESOLVED 2026-08-05 in Plan 2 (Task 1)** —
     added to the write shape as `z.record(z.string(), z.unknown()).nullable()
     .default(null)`, so Plan 4's Appearance screen has somewhere to save. The
     service writes SQL `NULL` when it is cleared, never the string `"null"`.

- **Plan 2 standing context — decisions not to re-litigate:**
  - **Admin API routes are `fbt/api/<resource>` with NO `v1` segment.** The spec
    said `/fbt/api/v1/{bundles,config,dashboard,catalog}` and **the spec is
    wrong** — it contradicted its own claim of following `wizzy` exactly.
    Verified across all 8 vendors: `v1` appears only in OAuth prefixes
    (`wizzy/api/v1/oauth`) plus a few special cases (`meta/api/v1/capi`); every
    admin API is unprefixed (`wizzy/api/catalog`, `loyalty/api/dashboard`).
    Plan 1 had already shipped `fbt/api/merchants`. Follow the repo.
  - **The Ratio products path is `/api/v1/v1/products` — the doubled `v1` is
    deliberate.** The platform's published docs say `/api/v1/products`, but
    every vendor in this repo calls the doubled form against the live gateway
    (`wizzy`, `google`, `meta`, `loyalty`). Do not "correct" it toward the docs.
  - **Collections have no Ratio API endpoint at all** — the documented resources
    are only `products` and `orders`. They come from a second, unauthenticated
    backend via `FBT_OS_STOREFRONT_URL` and a `gk-merchant-id` header. The
    merchant's OAuth token is never forwarded there, and every failure path
    degrades to an empty list. Full rationale: ADR
    [0007](../../context/decisions/0007-fbt-collections-from-unauthenticated-openstore-storefront.md).
  - **Bundle scope matching uses `JSON_CONTAINS(col, JSON_QUOTE(?))`, and the
    column name is written LITERALLY inside the raw `sql` fragment.** Two
    reasons, both load-bearing. First, the source app used
    `scope_product_ids LIKE '%"<id>"%'`, a substring scan over JSON text that
    breaks on any id containing a quote or bracket and fails by matching
    *nothing* rather than raising. Second, `CamelCasePlugin` does **not** rewrite
    identifiers inside raw fragments, so a `sql.ref('scopeProductIds')` there
    emits camelCase and fails at runtime with "unknown column" — which is why
    `findByProduct`/`findByCollection` are two small literal branches rather than
    one clever shared helper. A test pins both the function name and the
    snake_case column, verified by mutation: reintroducing `sql.ref` fails it.
  - **`packages/shared` resolves types from `src` but runtime from a gitignored
    `dist`, and `apps/backend`'s own `test` script does not build it.** Only the
    root `verify` script gets the order right (it runs
    `pnpm --filter @ratio-app/shared build` before `pnpm -r test`). Any backend
    test that imports a shared schema as a **runtime value** — not just a type —
    needs that build first, or it fails with a module-resolution error. This bit
    Plan 2's Task 5. `forms` and `meta` import shared schemas the same way, so
    this is a repo-wide trait, not FBT-specific.

- **Plan 2 known gaps and follow-ups, deliberately not fixed:**
  1. **A concurrent-refresh race in every Ratio token provider except two.**
     Ratio refresh tokens are single-use, so two overlapping `getAccessToken`
     calls for one merchant on an expired token can both refresh; the loser's
     rotated token is overwritten and dies, **permanently breaking that merchant
     until reinstall**. `google` and `rp` guard this with `SELECT … FOR UPDATE`
     plus a re-check inside a transaction. `wizzy`, `loyalty`, `meta`, and `fbt`
     do not. Not fixed in Plan 2 because it is a repo-wide gap affecting four
     vendors identically and fixing FBT alone would leave the repo inconsistent.
     **This is the highest-value follow-up on this list.**
  2. **`.set({...} as never)` in `oauth/ratio-token.provider.ts`** disables
     Kysely's column-name checking for that update, so a typo would not be
     caught by `tsc`. Byte-identical to `wizzy`'s existing pattern; worth a
     cleanup across all five providers, not one.
  3. **Envelope-shape coverage is shallow on both catalog clients.**
     `productSchema`'s envelope accepts four wrapper shapes but only
     `data.products` is exercised; collections accept three but only
     `data.collections` is tested.
  4. **`FbtBundlesService.remove()` has no ownership pre-check**, unlike every
     other mutator, so deleting a foreign or already-absent id silently no-ops
     rather than raising `BUNDLE_NOT_FOUND`. Plan 4 should decide what HTTP
     status a no-op delete returns.
  5. **`FbtBundleLookupService.resolve()`'s 404 message interpolates the raw
     product/collection id.** Harmless today; revisit in Plan 5, when that
     method goes onto a public unauthenticated storefront route.
  6. **The "null expiry must refresh" rule guards a state the schema forbids.**
     `BaseOauthTokensTable.expiresAt` is non-nullable and the DDL declares
     `expires_at NOT NULL`, so that branch is belt-and-braces rather than a
     reproduction of an observed failure mode.

## Change journal

### 2026-08-05 — feature — Plan 2 of 6: the admin API (bundles, config, catalog, dashboard)
- **What:** The merchant-guarded HTTP surface the admin needs, in eight reviewed
  tasks. Shared bundle schemas in `packages/shared` (plus the missing
  `uiConfig` config field); merchant config `GET`/`PUT` at `fbt/api/config`
  carrying the toggle-on scheduling contract; bundle CRUD with a `merchantId`
  filter on **every** query; bundle lookup precedence and preview; the
  nine-route bundles controller; a Ratio access-token provider handling
  single-use refresh rotation; catalog pickers for products (Ratio, OAuth'd) and
  collections (a second unauthenticated backend); and dashboard metrics from one
  grouped query rather than the source app's five `COUNT` round-trips.
- **Why:** Plan 1 left an installable app with no way to do anything. This is
  what `PARITY.md`'s four Plan 2 endpoint rows required, and it unblocks Plan 4's
  admin screens, which currently render inert placeholders.
- **Two security properties worth stating plainly.** First, **tenancy**: the
  source app took `merchant_id` from a *query parameter* on every route, so any
  merchant could read or mutate another's bundles by changing one value. Identity
  now comes only from the guard-populated `@CurrentMerchant()`, and every read,
  update, and delete filters on it — including `getById`, where that clause is
  the only thing preventing a cross-tenant read by UUID. Second, **token
  rotation**: a refresh returns a new access *and* refresh token and kills the
  old one, so both are re-encrypted and persisted in the same write as the new
  expiry.
- **Definition of done / fix:** All 8 tasks complete, each independently
  reviewed. 0 Critical and 0 Important findings survive. Tasks 5, 6, and 8
  passed first time; the other five each took exactly one fix round. Gates:
  `test/unit/apps/fbt` is 12 files / 131 tests green; backend `tsc --noEmit` and
  `biome check src/modules/fbt` both exit 0; `test/unit/config/env.schema.test.ts`
  still carries exactly its 8 pre-existing failures after the one env-key
  addition, not 9.
- **Worth knowing for the next plan:** every one of the six Important findings
  was a defect in the *plan's own test code*, not in an implementation — an
  assertion that named a property without guarding it. Two were outright
  vacuous: a `JSON.stringify` over a Kysely raw builder that returned `{}`
  (so the test "proving" we emit `JSON_CONTAINS` inspected an empty object), and
  an `indexOf` route-order comparison that passed with the handler deleted
  because `-1 < n`. The tenancy tests initially passed on an internal
  `getById` pre-check's `WHERE` clause and would not have caught the filter
  being dropped from the `UPDATE` itself. **The technique that actually settled
  these was requiring a deliberate-break check as evidence** — delete the
  filter, watch the named test fail, restore it. Assertions that survive that
  are trustworthy; ones that don't were measuring nothing.
- **Files:** `apps/backend/src/modules/fbt/{config,bundles,catalog,dashboard,oauth}/**`,
  `apps/backend/src/modules/fbt/{fbt.module.ts,tokens.ts}`,
  `packages/shared/src/schemas/fbt-{bundle,config}.ts`,
  `packages/shared/src/index.ts`, `apps/backend/test/unit/apps/fbt/**`,
  `apps/backend/src/config/env.schema.ts` (one key: `FBT_OS_STOREFRONT_URL`),
  `.env.example`.
- **Links:** plan `docs/superpowers/plans/2026-08-05-fbt-02-admin-api.md`
  (gitignored); ADR
  [0007](../../context/decisions/0007-fbt-collections-from-unauthenticated-openstore-storefront.md);
  parity checklist [PARITY.md](./PARITY.md).

### 2026-08-05 — cleanup — strip the PostHog pixel scaffold from `admin-fbt`
- **What:** Deleted the `_template` scaffold content the admin had inherited
  verbatim: `ScriptTagPanel.tsx`, `EventMapTable.tsx` (+ its test),
  `routes/install.tsx`, `routes/events.tsx`, `routes/config.tsx`,
  `hooks/useDefaults.ts`, `hooks/useConfig.ts`, the `.event-map-table` CSS, and
  the unused `defaults`/`config` query keys. Replaced the navigation and route
  skeleton with the source admin's five screens — Dashboard, Bundles,
  Recommendations, Appearance, Preview — and added
  `docs/agent/apps/fbt/PARITY.md` as the parity checklist.
- **Why:** The user's ruling: *"i dont want any pixel or anythign in this, i
  need this app same as osapp-freq-bought same functionality."* This was not
  cosmetic. `routes/config.tsx` imported `_templateConfigInputSchema` and
  `@shared/constants/_template-events`, and rendered a form asking the merchant
  for a *"Project API Key (starts with `phc_`)"* with hosts
  `https://us.i.fbt.com` — PostHog copy with a find-and-replace of the vendor
  name. `useConfig.ts` was typed against `TemplateConfig` and called
  `/api/fbt-config`, an endpoint that does not exist. Left in place, the first
  merchant to open the admin would have been asked to paste a `<script>` tag
  and enter a PostHog API key.
- **Definition of done / fix:** `admin-fbt` typecheck, lint, test, and build
  all exit 0; monorepo-wide `pnpm -r typecheck` exits 0. Zero `_template`,
  `event-map`, `phc_`, or pixel references remain in `apps/admin-fbt`.
  Deleting the only test file would have made `pnpm test` exit 1 (no test
  files) and broken the recursive run, so `Navbar.test.tsx` replaces it with a
  real guard: it pins the five screens as **literals**, asserts `/config`,
  `/events`, and `/install` are absent as both nav entries and route files, and
  checks every nav path has a backing route file.
- **Files:** `apps/admin-fbt/src/**`, `docs/agent/apps/fbt/PARITY.md`.

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
