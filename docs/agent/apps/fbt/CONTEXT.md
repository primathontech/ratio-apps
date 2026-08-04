# fbt — context

Living context for the FBT app (Frequently Bought Together — AI-generated
product bundle recommendations, migrated from a standalone service). Read
before touching this module. Standing context first; dated change journal
below (newest first).

## Standing context

- **This is a migration onto an EXISTING production database with live
  merchants, not a new app.** `RATIO_FBT_DATABASE_URL` points at FBT's real
  production schema (`frequently_bought_bundle`, `merchant_recommendation_config`,
  `product_embeddings`, `product_similarity_cache`, `bundle_generation_jobs`,
  `platform_merchants`, plus the `synchronize: true` TypeORM artifacts
  `webhooks` / `uploaded_files`). The OLD (TypeORM) backend keeps serving those
  same merchants from that same database throughout the cutover window — so
  **`0001_initial.ts` must be additive-only**: no `dropTable` / `dropColumn` /
  `renameTo` / `renameColumn`, no tightening `NOT NULL`, no `ALTER … CHANGE`.
  Destructive cleanup is `0002`, which is Plan 6 and runs only after the old
  backend is decommissioned.
- **Two enforcement mechanisms for "additive-only", complementary rather than
  redundant.**
  1. `test/unit/apps/fbt/migration-additive.test.ts` — a static guard that reads
     `0001`'s source TEXT and greps for destructive DDL: Kysely builder calls
     AND raw SQL, including MySQL's `DROP KEY` / `DROP PRIMARY KEY` /
     `DROP FOREIGN KEY` synonyms for `DROP INDEX`/`DROP CONSTRAINT`.
  2. `pnpm verify:fbt:additive` — an empirical verifier. Applies `0001`
     in-process to a production-shaped fixture
     (`test/fixtures/fbt-production-schema.sql`, hand-derived from the source
     repo's own TypeORM migrations) and diffs column shape + row counts
     before/after.
  Proven asymmetry: a `JSON`→`LONGTEXT` retype via `ALTER … MODIFY` is invisible
  to the static guard (it only checks the NOT-NULL direction on `MODIFY`) but is
  caught by the verifier. A dropped INDEX or CONSTRAINT is caught by **neither**
  — the verifier snapshots columns and row counts only, not indexes or
  constraints. Keep both checks; neither alone is sufficient.
- **No Shopify.** All live merchants are OpenStore/Ratio. `platform` is written
  as the literal `'openstore'` everywhere and read but never branched on; it is
  dropped in `0002`. No Shopify code is ported from the source repo.
- **No event map.** FBT forwards no storefront events, so it ships no
  `fbt-events.ts` / `DEFAULT_FBT_EVENT_MAP` — same precedent as `wizzy`.
- **Table naming is deliberately inconsistent, on purpose.** The five
  pre-existing production tables keep their bare names (no `fbt_` prefix)
  because renaming them would be a destructive `renameTo` against a live
  database. Tables this module newly introduces (`fbt_sweep_lease`) DO take the
  `fbt_` prefix. Precedent: `rp` ships `return_prime_merchants` alongside
  `rp_id_mappings`.
- **`allowAutomaticRecommendation` defaults `false`.** Install seeds one
  `merchant_recommendation_config` row (`FbtBootstrap`) with automation OFF and
  `nextRunAt = NULL`, so a fresh install spends no OpenAI budget until a
  merchant opts in.
- **`createSharedTables` is guarded, and only inside `0001`.** The shared-table
  helper (`merchants`, `oauth_tokens`, `webhook_log`) is called with existence
  checks so a partial/resumed migration run doesn't fail re-creating a table
  that already exists; `core/` itself is untouched — the guard lives entirely
  in `0001_initial.ts`.
- **Row lease, not `GET_LOCK`, for the sweep.** `fbt_sweep_lease` (table created
  here, acquisition logic is Plan 3's) is a plain row with a `lockedUntil`
  expiry rather than MySQL's `GET_LOCK`, because `GET_LOCK` is scoped to a
  single CONNECTION and Kysely hands out pooled connections — a release could
  land on a different connection than the acquire and leak the lock forever. A
  row lease is atomic, connection-independent, and self-heals on expiry.
- **What Plans 2–6 own** (deferred deliberately, not overlooked): Plan 2 —
  bundle CRUD, lookup, scope resolution, dashboard, catalog. Plan 3 —
  embeddings/similarity/sweep logic and lease *acquisition* (Plan 1 only
  creates the `fbt_sweep_lease` table + seed row), the `FBT_*` sweep env knobs,
  and `product_deleted` stripping ids from auto-bundles'
  `recommendation_product_list`. Plan 4 — admin screens (`apps/admin-fbt`
  scaffolds here only so the workspace typechecks). Plan 5 — `packages/fbt-sdk`
  and its real shared types; not scaffolded from `_template-sdk` in Plan 1
  because that template is search-shaped (modeled on `wizzy`) and Plan 5
  rewrites it entirely against a `window.ProductBundler` contract. Plan 6 —
  cutover and the destructive `0002` migration.
- **Two carry-forwards Plan 6 must not lose:**
  1. `0002`'s drops of `webhooks` and `uploaded_files` need `IF EXISTS`. No
     migration in this repo or the source repo creates either table — they are
     `synchronize: true` TypeORM artifacts — so whether they exist in the real
     production database is unknown, and neither is in the verifier's fixture.
  2. The backfill (`0001_initial.backfill.sql`) derives `merchants.installed_at`
     from a `UNION` over two independently-`GROUP BY`'d `MIN(created_at)`
     queries — one per source table — with no outer `GROUP BY`. A merchant with
     rows in BOTH `frequently_bought_bundle` and `merchant_recommendation_config`
     produces two candidate rows with different `first_seen` values feeding one
     `ON DUPLICATE KEY UPDATE` insert, so its `installed_at` ends up being
     whichever row MySQL happens to process last — nondeterministic, and not a
     bug that will announce itself.

## Change journal

### 2026-08-04 — feature — Plan 1: scaffold + additive schema foundation
- **What:** Stood up `fbt` as a wired, installable vendor app
  (`apps/backend/src/modules/fbt`, `apps/admin-fbt`) scaffolded from
  `_template`, with the real 9-table `FbtDatabase` replacing the template's
  placeholder config table, an additive-only `0001_initial.ts` migration, the
  install bootstrap (seeds one disabled `merchant_recommendation_config` row),
  the uninstall handler (soft-deletes the merchant), and the three product
  webhook handlers (invalidate embedding + similarity cache on
  create/update/delete).
- **Why:** Plan 1 of 6 migrating the standalone FBT service into this monorepo
  as a vendor app, pointed at FBT's existing production database. Everything
  here exists to make that migration provably safe: `0001` cannot break the OLD
  backend that keeps serving the same merchants until Plan 6's cutover.
- **Definition of done / fix:** Final whole-branch review before merge found
  four defects, all fixed in this pass:
  1. **All four webhook topic strings were wrong.** `topics.ts` used dot-form
     (`app.uninstalled`, `product.created/updated/deleted`); the platform
     registry's real values are slash-form, plural resource, base verb
     (`app/uninstalled`, `products/create`, `products/update`,
     `products/delete`). Wrong topics don't error — `WebhooksService.dispatch`
     silently no-ops on a mismatch — so every handler here would never have run
     in production. Fixed the four values plus the stale docstring and the
     handler's `// NOTE:` comment. No test hardcoded a dot-form literal (every
     assertion goes through the `FBT_TOPICS` constant), so nothing was silently
     passing against the wrong value — only a test *description* string needed
     updating.
  2. **The additive guard's `raw DROP` regex missed MySQL DROP synonyms** —
     widened from `TABLE|COLUMN|INDEX|CONSTRAINT` to also catch `KEY`,
     `PARTITION`, `PRIMARY KEY`, `FOREIGN KEY`. The verifier doesn't snapshot
     indexes/constraints either, so a dropped unique constraint had been
     invisible to both mechanisms.
  3. **This file didn't exist.** `docs/superpowers/` and `.superpowers/` (the
     plan and its execution ledger) are both gitignored, so the plan's
     amendments and every deferred decision would have disappeared on merge.
     Created, plus the `fbt` row in `docs/agent/FEATURES.md`.
  4. `verify-fbt-additive.mjs`'s scratch-host allowlist gained the
     docker-compose service hostname `mysql`, so the verifier can run from
     inside the compose network (e.g. CI), not only from the host.
- **Files:** `apps/backend/src/modules/fbt/**`, `apps/admin-fbt/**`,
  `apps/backend/test/unit/apps/fbt/**`,
  `apps/backend/scripts/verify-fbt-additive.mjs`,
  `apps/backend/test/fixtures/fbt-production-schema.sql`,
  `apps/backend/src/config/apps.ts`, `apps/backend/src/module-registry.ts`,
  `packages/shared/src/schemas/fbt-config.ts`,
  `docker/mysql/init/01-database.sql`, `.env.example`, `package.json`.
- **Links:** plan `docs/superpowers/plans/2026-08-04-fbt-01-foundation.md`
  (gitignored — not in the merged tree); ledger
  `.superpowers/sdd/2026-08-04-fbt-01-foundation/` (also gitignored).
