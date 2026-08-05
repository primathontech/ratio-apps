# fbt — parity with `osapp-freq-bought`

The target for this app is **functional parity with the standalone
`osapp-freq-bought`**, rebuilt on `ratio-apps` conventions. Nothing from the
PostHog-shaped `_template` scaffold belongs here.

Ground truth is the source repo, kept read-only as reference:
`../osapp-freq-bought` — four projects (`backend`, `automated-bundle-service`
a.k.a. ABS, `admin`, `sdk`).

This file is the checklist. A plan is not done until its rows are ✅.

## Data model — verified complete

Column-by-column against the source TypeORM entities. `fbt_` tables are a
**superset** of the source schema; the only removals are deliberate (below).

| Source table | Ours | Verified |
|---|---|---|
| `frequently_bought_bundle` | `fbt_bundles` | ✅ all 16 columns; `status`/`scope_type`/`mode` enum values match exactly |
| `merchant_recommendation_config` | `fbt_merchant_config` | ✅ all columns incl. `ui_config`, plus new scheduling columns |
| `product_embeddings` | `fbt_product_embeddings` | ✅ all columns (`embedding_vector` → `embedding_blob`) |
| `product_similarity_cache` | `fbt_similarity_cache` | ✅ all columns, plus `updated_at` |
| `bundle_generation_jobs` | `fbt_generation_jobs` | ✅ all columns; `job_type` and `status` enum values match exactly |
| — (ABS used env-driven cron) | `fbt_sweep_lease` | ✅ new; replaces the env-var scheduler |

Enum values pinned as literals, matching source:
`status` = draft/published/paused/archived · `scope_type` =
all_products/specific_product/specific_collections · `mode` = auto/manual ·
`job_type` = full_sync/incremental/single_product/embedding_generation ·
`job status` = pending/running/completed/failed/cancelled.

## Backend endpoints

| Source | Ours | Owner | Status |
|---|---|---|---|
| `auth/*` (Shopify + OS OAuth) | `core/oauth` → `fbt/api/v1/oauth` | Plan 1 | ✅ |
| `webhooks/receive` | `core/webhooks` → `fbt/api/webhooks` | Plan 1 | ✅ |
| `health` | platform-level, already in `ratio-apps` | — | ✅ |
| `bundles` (9 routes: CRUD, `lookup`, `duplicate`, `:id/status`, `:id/preview`) | `fbt/api/bundles` | Plan 2 | ☐ |
| `merchant/:id/recom-config` GET+PUT | `fbt/api/config` | Plan 2 | ☐ |
| `dashboard` | `fbt/api/dashboard` | Plan 2 | ☐ |
| `merchants/products`, `products/ids`, `products/variants/ids`, `collections`, `collections/ids` | `fbt/api/catalog/*` | Plan 2 | ☐ |
| ABS scheduler + embedding + similarity + bundle-creation services | the sweep | Plan 3 | ☐ |

`useConfig`'s path is unassigned on purpose: the deleted scaffold hook called
`/api/fbt-config`, which never existed. `api()` prepends `/fbt`, so Plan 2's
controller should be `@Controller('fbt/api/config')` and the hook should call
`/api/config`.

## Admin screens

Route skeleton and navigation exist and are pinned by
`admin-fbt/src/components/Navbar.test.tsx`; the screens themselves are Plan 4.

| Source screen | Route | Status |
|---|---|---|
| `dashboard.tsx` | `/` | ◐ install status live; bundle metrics need Plan 2 |
| `bundles-new.tsx` + `CampaignTable` | `/bundles` | ☐ placeholder |
| `recommendations.tsx` | `/recommendations` | ☐ placeholder |
| `appearance.tsx` | `/appearance` | ☐ placeholder |
| `preview.tsx` | `/preview` | ☐ placeholder |

The three-step bundle wizard is **Basics & Scope → UI Module → Review &
Publish**. The Appearance screen writes `fbt_merchant_config.ui_config` — a
column that exists but is **absent from `fbtMerchantConfigSchema`**; Plan 2
must add it to the write shape.

## Storefront SDK

Source `sdk/` is a Bun-built multi-purpose SDK; only
`src/modules/frquentlyBoughtTogether.tsx/` (sic) is FBT. Plan 5 ships
`packages/fbt-sdk` as a Lit 3 widget per repo convention — a
contract-preserving rewrite, not a port.

## Deliberate exclusions — do not "restore" these

Each was checked against the source, not assumed.

| Excluded | Evidence |
|---|---|
| `platform` column on every table | No live Shopify merchants; all merchants are OpenStore/Ratio. `core/oauth` speaks only Ratio and forking it per vendor is forbidden. |
| Shopify OAuth, `shopify-graphql.service`, `webhooks/shopify` | Same. |
| Event map / `fbt-events.ts` | FBT forwards no storefront events. Precedent: `wizzy`. |
| `<script>`-tag install screen | FBT's widget is served by an already-deployed storefront wrapper fetching `/fbt/sdk/config/:merchantId`. There is nothing for a merchant to paste. |
| `files/*` upload subsystem (S3 + local storage, image processor, validator, rate limiter) | **Mounted but unused in the source app**: the admin never calls it, and no bundle entity column references an uploaded file. Not FBT functionality. |
| `bundle-cache-health/*` (`test`/`stats`/`invalidate`/`warm`) | Developer diagnostics against ABS's Redis cache, not merchant-facing. Revisit only if Plan 3 wants ops endpoints. |
| Surrogate `id` on the config table | One row per merchant; `merchant_id` is the natural key. Matches `wizzy_configs`. |
| ABS as a separate service + its env-driven cron (`ACTIVE_MERCHANTS`, `FULL_SYNC_CRON`) | Replaced by per-merchant DB scheduling (`sync_frequency`, `sync_hour_utc`, `sync_weekday`, `next_run_at`) plus `fbt_sweep_lease`. This was the point of the migration. |
