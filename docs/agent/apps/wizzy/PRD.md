# PRD — Wizzy (AI Search & Discovery)

> Structured from the source "Wizzy Integration" PRD. Ratio's equivalent of Wizzy's
> Shopify app: a 1P vendor app that pushes the merchant's product catalog to Wizzy's
> indexing API and injects the Wizzy JS SDK onto the storefront via the ScriptTag API,
> so migrating merchants keep best-in-class AI search.
>
> **Reframe from the source PRD:** the source doc is written platform-side ("Wizzy's
> eng team builds the install handler; Ratio builds nothing"). In *this* repo we build
> the **Wizzy vendor app** — the backend module (`apps/backend/src/modules/wizzy/`) +
> admin SPA (`apps/admin-wizzy/`) that stores merchant config, receives the product
> webhooks, transforms + pushes products to Wizzy's `POST /products/save` /
> `POST /products/delete`, runs the initial bulk + reconcile sync, and registers the
> Wizzy SDK ScriptTag. This maps almost 1:1 onto the existing `google` app.

## Vendor name & slug

- **Display name:** Wizzy
- **Slug:** `wizzy`

The slug drives every derived name: backend module
(`apps/backend/src/modules/wizzy/`), admin app (`apps/admin-wizzy/`), URL prefix
(`/wizzy/*`), and `RATIO_WIZZY_*` env keys. Validated `^[a-z0-9-]+$`, not present in
the `APPS` tuple, and `apps/admin-wizzy/` does not exist — slug is free.

### Dependency flag (carried to TRD / GATE 2)

The **SDK-injection (ScriptTag) path** depends on the **ScriptTag API**
(`write_script_tags` / `read_script_tags`), which is **Draft** on the platform — both
scopes report `codegen_ready: false`. The **catalog-sync path** is independent and
fully buildable today: `read_products` is `codegen_ready: true`, and the
`products/create|update|delete` webhooks exist (HMAC-SHA256, 3 retries 5s/30s/5m).

**Resolution for this build (decided GATE-0):** config storage, catalog transform +
push, initial bulk sync, and reconcile are built **unconditionally**. The ScriptTag
register/update/delete calls are isolated behind a guarded SDK method that **no-ops
with a clear `pending_api` status** when the API is unavailable, so the app ships and
syncs catalog now; the SDK auto-injects the moment the ScriptTag API lands. The TRD
pins exactly where that guard lives. (Mirrors `google`'s Web Pixels API gate.)

### Platform corrections inherited from the `google` build

- **Prices are in rupees, not paise.** The Ratio product price is already a rupee
  decimal — the transformer does **not** divide by 100 (the source PRD's `price/100`
  is dropped). Confirmed by the `google` GMC build.
- **Pagination is page/offset, not cursor.** The real catalog API is
  `GET /api/v1/products?limit=&page=` (and `?all=true`), **not** the Shopify-style
  cursor `page_info` the source PRD §8 assumed. Bulk sync iterates pages until a short
  page is returned.

## Problem

Ratio's native search is basic keyword matching — no semantic understanding, no typo
tolerance, no Hindi/Hinglish transliteration, no merchandising. Enterprise Indian D2C
brands migrating from Shopify (Wellversed, PlixKids) run Wizzy for AI-powered search
today; without a Wizzy integration they regress their best-converting discovery layer
on Ratio, which is a direct conversion-rate risk and a migration blocker.

**Merchants** want to install Wizzy on their Ratio store, have their catalog stay in
sync automatically, and configure search entirely in Wizzy's own dashboard — no new
admin to learn. **The onboarding/account team** wants self-serve install instead of
hand-holding each migration. **The platform** wants a reusable catalog-export +
product-webhook + ScriptTag path that future search/discovery apps also consume.

**Outcome:** merchant installs the Wizzy app → enters Wizzy Store ID + Store Secret →
catalog bulk-syncs to Wizzy and stays current via webhooks → the Wizzy SDK injects on
the storefront (once ScriptTag API is live) → AI search works identically to Shopify.

## Data model (tables / fields)

Beyond the standard `merchants`, `oauth_tokens` (Ratio OAuth), and `webhook_log`
tables every module already has. Secrets are encrypted at rest.

| Table | Column | Type | Notes |
|---|---|---|---|
| `wizzy_configs` | `merchant_id` | varchar(128) PK | FK → `merchants.id` |
| | `wizzy_enabled` | tinyint(1) default 0 | per-merchant kill switch (disable → stop sync + SDK) |
| | `store_id` | varchar(128) NULL | Wizzy Store ID (catalog API auth) |
| | `store_secret` | text NULL | **secret, encrypted** — Wizzy Store Secret |
| | `sdk_url` | varchar(512) default `https://cdn.wizzy.ai/sdk/v2/wizzy.min.js` | SDK src registered via ScriptTag; editable for version bumps |
| | `script_tag_id` | varchar(128) NULL | id returned by ScriptTag API (null until registered) |
| | `script_tag_status` | enum(`active`,`pending_api`,`error`,`disabled`) default `disabled` | registration state (guarded path) |
| | `auto_sync_enabled` | tinyint(1) default 1 | push on product create/update/delete |
| | `include_out_of_stock` | tinyint(1) default 1 | sync out-of-stock products (variant `available:false`) |
| | `strip_html_description` | tinyint(1) default 1 | strip HTML from `description` before push |
| | `last_bulk_sync_at` | datetime NULL | last full/initial sync completion |
| | `created_at` / `updated_at` | datetime | |
| `wizzy_catalog_items` | `id` | bigint PK auto | per-product sync health (admin catalog table) |
| | `merchant_id` | varchar(128) | FK → `merchants.id` |
| | `product_id` | varchar(128) | source Ratio product id |
| | `wizzy_id` | varchar(255) | id sent to Wizzy (product id as string) |
| | `title` | varchar(255) NULL | cached for the catalog-details table |
| | `status` | enum(`SYNCED`,`PENDING`,`ERROR`,`DELETED`) | per-item state |
| | `issue` | varchar(512) NULL | Wizzy API error / transform warning |
| | `last_synced_at` | datetime NULL | |
| | `created_at` / `updated_at` | datetime | UNIQUE(`merchant_id`,`product_id`) |
| `wizzy_sync_log` | `id` | bigint PK auto | sync-history rows for the admin |
| | `merchant_id` | varchar(128) | FK → `merchants.id` |
| | `sync_type` | enum(`initial`,`webhook`,`auto`,`manual`) | what triggered the run |
| | `products_checked` | int default 0 | |
| | `products_synced` | int default 0 | |
| | `products_errored` | int default 0 | |
| | `detail` | varchar(512) NULL | human-readable summary |
| | `created_at` | datetime | |

## Scopes / permissions

- `read_products` — read the product catalog for bulk sync; also the required scope
  for the `products/*` webhooks. (`codegen_ready: true`.)
- `write_script_tags` — register / update / delete the Wizzy SDK script tag.
  (Draft path — `codegen_ready: false`; guarded, see dependency flag.)
- `read_script_tags` — read script-tag status for the admin SDK health card.
  (Draft path — `codegen_ready: false`.)

## Webhook events

- `app/uninstalled` — delete the Wizzy script tag (guarded), disable sync, mark
  merchant inactive (default, wired by template).
- `products/create` — transform product → push to Wizzy `POST /products/save`; upsert
  `wizzy_catalog_items` with resulting status.
- `products/update` — transform → `POST /products/save` (upsert); refresh
  `wizzy_catalog_items`. Unpublish/archive → treat as delete.
- `products/delete` — `POST /products/delete` by id; mark `wizzy_catalog_items` row
  `DELETED`.

Verification: HMAC-SHA256 over the raw body via `X-Ratio-Hmac-SHA256` (template
guard), key = app `client_secret`. Retry policy: 3 retries (5s/30s/5m) then disabled.

## Admin screens

- **Connect / Config** — enter **Wizzy Store ID** + **Store Secret** (Store Secret is
  a write-secret: masked, encrypted at rest, never returned to the client), the SDK
  URL (defaulted), and the `wizzy_enabled` toggle. Credentials format-validated and
  verified with a test Wizzy API call before save.
- **Dashboard (main)** — two status cards:
  - *Catalog Sync* — synced / pending / error counts, last bulk sync time, **View
    Catalog Details** + **Force Sync Now** + Settings.
  - *Storefront SDK (ScriptTag)* — status (Active / **Pending API** / Error /
    Disabled), registered SDK URL, and a "pending ScriptTag API" explainer when in
    `pending_api`.
- **Sync settings** — auto-sync toggle, include-out-of-stock toggle, strip-HTML
  toggle, SDK URL.
- **Catalog details** — filterable per-product table (Product / Status / Issue /
  Last Synced), pagination, and a sync-history list; Force Sync Now action.

## Acceptance criteria

- [ ] Merchant can save config — Wizzy Store ID + Store Secret + SDK URL + enable
      toggle — with format validation and a Wizzy test API call; config persists, the
      Store Secret encrypted and never returned to the client.
- [ ] `products/create` / `products/update` / `products/delete` webhooks
      (HMAC-verified) transform the product (rupee prices, variant `available` from
      stock, HTML optionally stripped) and call Wizzy `POST /products/save` /
      `POST /products/delete`, updating `wizzy_catalog_items`.
- [ ] Initial full-catalog bulk sync runs on connect (page/offset pagination, batched
      to Wizzy `/products/save`); a manual Force-Sync re-runs it; both append
      `wizzy_sync_log` rows.
- [ ] Unpublished/archived products are removed from the Wizzy index (treated as
      delete); out-of-stock handling follows the `include_out_of_stock` toggle.
- [ ] ScriptTag registration is attempted via the ScriptTag API and, when that Draft
      API is unavailable, `script_tag_status` is recorded as `pending_api` (no crash);
      SDK URL changes call update, uninstall calls delete — all behind the guard.
- [ ] `wizzy_enabled = false` (merchant kill switch) suspends webhook push and removes
      the SDK script tag; re-enabling restores both. Wizzy's own index persists.
- [ ] Catalog-details screen shows per-product status + issue + last-synced and a sync
      history; Force Sync Now triggers a manual sync.
- [ ] `app/uninstalled` deletes the script tag (guarded) and flips the merchant
      inactive.
- [ ] `pnpm -r lint && pnpm -r typecheck && pnpm -r build` pass.

## Out of scope

- **Storefront SDK loading + Next.js event wiring** (search / product_click /
  add_to_cart / page_view / purchase events) — these live in the Ratio **storefront /
  Next.js repo**, owned by Frontend Core, not this backend+admin monorepo. This build
  registers the ScriptTag (the injection mechanism); the storefront-side lifecycle
  wiring is tracked separately.
- Any Ratio-built search/discovery UI — Wizzy's JS SDK renders the widget entirely.
- Any Ratio configuration UI for search rules / merchandising — Wizzy's own dashboard
  is the admin for that.
- Wizzy advanced widget features (Visual Search, Conversational AI, Reels View) —
  SDK-side, work automatically once the SDK loads; not validated here. (v2)
- Metafields / custom product attributes mapping — Ratio metafields equivalent not
  built. (v2)
- Collections mapping in the transformer if the catalog API does not expose collection
  membership on the product payload — start with core product fields; revisit in v1.1.
- The ScriptTag API itself — this app **consumes** it; if unavailable at build time,
  SDK injection degrades to `pending_api` rather than blocking the build (dependency
  flag).
