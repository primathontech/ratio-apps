# PRD — Google (GA4 + Google Ads + Merchant Center)

> Structured from the source "GA4 + GMC App" PRD. Ratio's equivalent of Shopify's
> **Google & YouTube** app: one 1P app bundling GA4 analytics, Google Ads
> conversion tracking, and Google Merchant Center (GMC) product-feed sync.
> Scope of this build: **all three integrations** (full source-PRD Phase 1), with
> **both** manual-config and OAuth account connection.

## Vendor name & slug

- **Display name:** Google
- **Slug:** `google`

The slug drives every derived name: backend module
(`apps/backend/src/modules/google/`), admin app (`apps/admin-google/`), URL prefix
(`/google/*`), and `RATIO_GOOGLE_*` env keys.

### Dependency flag (carried to TRD / GATE 2)

The **GA4 + Google Ads pixel registration** path depends on the **Web Pixels API**
(`POST /pixels`), which is **Draft** on the platform — the `write_pixels` /
`read_customer_events` scopes report `codegen_ready: false`. The **GMC product-feed
sync** path is independent and fully buildable today (`read_products` is
`codegen_ready: true`).

**Resolution for this build:** config storage and SDK-adapter wiring for GA4/Ads
are built unconditionally. The single pixel-registration call is isolated behind a
guarded SDK method that no-ops with a clear "pending Web Pixels API" status when the
API is unavailable, so the rest of the app (GMC sync, admin, config) ships and works
regardless. The TRD pins exactly where that guard lives.

## Problem

**Merchants** configure GA4 and Google Ads tracking via env vars today — changing a
Measurement ID needs a developer and a redeploy. GMC product-feed setup is fully
manual (Google Cloud project, Content API, service account, JSON key, GMC link),
costing hours per merchant, and product updates never auto-push to GMC, so Shopping
ads and free listings go stale. There is no admin visibility into whether GA4 events
flow or the GMC feed is in sync.

**The onboarding team** spends large amounts of time hand-holding each merchant
through Google Cloud and GMC setup; feed errors surface late.

**The platform** cannot scale Google integrations past a handful of merchants on
env vars + manual setup, and merchants cannot self-serve.

**Outcome:** Merchant installs the Google app → connects a Google account (OAuth or
manual) → GA4 events flow, Google Ads conversions track, products auto-sync to GMC →
free listings appear on Google Shopping. Self-serve, zero engineering involvement.

**Users:** merchants and their marketing managers (self-serve config + feed health);
the onboarding team (drastically reduced setup time).

## Data model (tables / fields)

Beyond the standard `merchants`, `oauth_tokens` (Ratio OAuth), and `webhook_log`
tables every module already has. Secrets are encrypted at rest.

| Table | Column | Type | Notes |
|---|---|---|---|
| `google_configs` | `merchant_id` | varchar(128) PK | FK → `merchants.id` |
| | `connection_method` | enum(`oauth`,`manual`) | how the account was connected |
| | `google_account_email` | varchar(320) NULL | display only; set on OAuth connect |
| | `ga4_enabled` | tinyint(1) default 0 | GA4 integration on/off |
| | `ga4_measurement_id` | varchar(20) NULL | `G-XXXXXXXXXX` |
| | `ga4_pixel_id` | varchar(128) NULL | id returned by Web Pixels API (null until registered) |
| | `ga4_pixel_status` | enum(`active`,`pending_api`,`error`,`disabled`) default `disabled` | registration state |
| | `ads_enabled` | tinyint(1) default 0 | Google Ads integration on/off |
| | `ads_conversion_id` | varchar(32) NULL | numeric conversion id |
| | `ads_conversion_label` | varchar(64) NULL | alphanumeric label |
| | `ads_pixel_id` | varchar(128) NULL | id returned by Web Pixels API |
| | `ads_pixel_status` | enum(`active`,`pending_api`,`error`,`disabled`) default `disabled` | registration state |
| | `enhanced_conversions_enabled` | tinyint(1) default 1 | hashed-PII enhanced conversions |
| | `gmc_enabled` | tinyint(1) default 0 | GMC feed sync on/off |
| | `gmc_merchant_id` | varchar(32) NULL | Merchant Center account id |
| | `gmc_service_account_key` | text NULL | **secret, encrypted** (manual-config path) |
| | `gmc_target_country` | varchar(2) default `IN` | ISO 3166-1 alpha-2 |
| | `gmc_content_language` | varchar(5) default `en` | ISO 639-1 |
| | `gmc_currency` | varchar(3) default `INR` | feed currency |
| | `gmc_default_condition` | enum(`new`,`refurbished`,`used`) default `new` | |
| | `gmc_brand_override` | varchar(255) NULL | overrides product vendor when set |
| | `gmc_google_product_category` | varchar(255) NULL | default Google taxonomy id |
| | `gmc_category_mode` | enum(`auto`,`default`,`per_type`) default `default` | category strategy |
| | `auto_sync_enabled` | tinyint(1) default 1 | sync on product create/update/delete |
| | `hourly_reconcile_enabled` | tinyint(1) default 1 | hourly drift fix |
| | `sync_variants_enabled` | tinyint(1) default 1 | each variant = separate GMC product |
| | `include_out_of_stock` | tinyint(1) default 1 | sync with `availability: out_of_stock` |
| | `free_listings_enabled` | tinyint(1) default 1 | Google Shopping free listings |
| | `created_at` / `updated_at` | datetime | |
| `google_credentials` | `merchant_id` | varchar(128) PK | FK → `merchants.id`; Google OAuth tokens (distinct from Ratio's) |
| | `access_token` | text | **secret, encrypted** |
| | `refresh_token` | text NULL | **secret, encrypted** |
| | `expires_at` | datetime NULL | access-token expiry (drives refresh) |
| | `granted_scopes` | text NULL | space-delimited Google scopes granted |
| | `created_at` / `updated_at` | datetime | |
| `google_feed_items` | `id` | bigint PK auto | |
| | `merchant_id` | varchar(128) | FK → `merchants.id` |
| | `offer_id` | varchar(255) | GMC offerId (store-prefixed product/variant id) |
| | `product_id` | varchar(128) | source Ratio product id |
| | `variant_id` | varchar(128) NULL | source variant id (null = single-variant product) |
| | `title` | varchar(255) NULL | cached for the feed-details table |
| | `status` | enum(`SYNCED`,`PENDING`,`ERROR`,`WARNING`,`DELETED`) | per-item feed health |
| | `has_gtin` | tinyint(1) default 0 | drives the GTIN column / warning |
| | `issue` | varchar(512) NULL | GMC error/warning message |
| | `last_synced_at` | datetime NULL | |
| | `created_at` / `updated_at` | datetime | UNIQUE(`merchant_id`,`offer_id`) |
| `google_sync_log` | `id` | bigint PK auto | sync-history rows for the admin |
| | `merchant_id` | varchar(128) | FK → `merchants.id` |
| | `sync_type` | enum(`webhook`,`auto`,`reconcile`,`initial`,`manual`) | what triggered the run |
| | `products_checked` | int default 0 | |
| | `products_updated` | int default 0 | |
| | `products_errored` | int default 0 | |
| | `detail` | varchar(512) NULL | human-readable summary |
| | `created_at` | datetime | |

## Scopes / permissions

- `read_products` — read the product catalog for GMC feed sync; also the
  required scope for the `products/*` webhooks. (`codegen_ready: true`.)
- `write_pixels` — register the GA4 and Google Ads pixels via the Web Pixels API.
  (Draft path — `codegen_ready: false`; guarded, see dependency flag.)
- `read_pixels` — read registered-pixel status for the admin health cards.
- `read_customer_events` — read pixel event health / logs surfaced in the admin.

## Webhook events

- `app/uninstalled` — disconnect Google, mark merchant inactive, disable pixels
  (default, wired by template).
- `products/create` — transform product (+ variants) → push to GMC; upsert
  `google_feed_items` rows with resulting status.
- `products/update` — transform → update in GMC; refresh `google_feed_items` status.
- `products/delete` — delete product/variants from GMC; mark feed items `DELETED`.

Verification: HMAC-SHA256 over the raw body via `X-Ratio-Hmac-SHA256` (template
guard). Platform retry policy: 3 retries (5s/30s/5m) then the webhook is disabled.

## Admin screens

- **Connect / Install** — choose connection method: **OAuth** (Connect Google
  Account button → Google consent → select GA4 property / Ads account / GMC account)
  or **Manual config** (enter GA4 Measurement ID, Ads Conversion ID + Label, GMC
  Merchant ID + service-account JSON key). Manual entries are format-validated; GMC
  key is verified with a test Content API call before save.
- **Dashboard (main)** — three status cards:
  - *GA4 Analytics* — property/Measurement ID, status (Active / Pending API / Error),
    events-today + last-event health, Settings link.
  - *Google Ads Conversions* — account, Conversion ID, tracked actions, enhanced-
    conversions toggle state, Settings link.
  - *Google Merchant Center* — account, synced / warning / error counts, last sync +
    next reconcile time, free-listings state, **View Feed Details** + **Force Sync
    Now** + Settings.
- **GA4 settings** — Measurement ID, enable/disable.
- **Google Ads settings** — Conversion ID + Label, enable/disable, enhanced-
  conversions toggle.
- **GMC settings** — account (Merchant ID, target country, language, currency),
  product defaults (condition, brand override, Google product category + mode), sync
  settings (auto-sync, hourly reconcile, variant sync, include out-of-stock), free
  listings toggle.
- **Feed details** — filterable per-product table (Product / Status / GTIN / Issue),
  pagination, and a sync-history list; Force Sync Now action.

## Acceptance criteria

- [ ] Merchant can connect via **manual config** — GA4 Measurement ID (`G-*`), Ads
      Conversion ID + Label, GMC Merchant ID + service-account key — with format
      validation and a GMC test API call; config persists, secrets encrypted.
- [ ] Merchant can connect via **OAuth**; Google access/refresh tokens persist
      encrypted in `google_credentials`; expired access tokens auto-refresh, and a
      failed refresh surfaces a "Reconnect" prompt.
- [ ] GA4 + Google Ads config persists and the SDK-adapter wiring is in place;
      pixel registration is attempted via the Web Pixels API and, when that Draft
      API is unavailable, the pixel status is recorded as `pending_api` (no crash).
- [ ] Enhanced conversions can be toggled; when enabled, conversion events carry
      SHA-256-hashed PII per the source-PRD field mapping.
- [ ] `products/create` / `products/update` / `products/delete` webhooks
      (HMAC-verified) transform the product (each variant a separate GMC product
      linked by `itemGroupId`) and insert/update/delete it in GMC, updating
      `google_feed_items`.
- [ ] Initial full-catalog sync runs on connect (batched); an hourly reconciliation
      job fixes drift; both append `google_sync_log` rows.
- [ ] Product mapping covers all required GMC attributes + India MRP
      (`maximumRetailPrice` from `compare_at_price`); missing-image/price → `ERROR`,
      missing-GTIN → `WARNING` (`identifierExists:false`, SKU as `mpn`).
- [ ] Feed-details screen shows per-product status, GTIN, issue, and sync history;
      Force Sync Now triggers a manual sync.
- [ ] `app/uninstalled` disables pixels and flips the merchant inactive.
- [ ] `pnpm -r lint && pnpm -r typecheck && pnpm -r build` pass.

## Out of scope

- Performance Max campaigns, ad-campaign management, audience/remarketing-list
  building, Product Studio / AI image tools (Google-side; never in this app).
- Analytics dashboards (merchants use the GA4 UI) and domain verification (Search
  Console).
- Server-side GA4 via Measurement Protocol (P1), Google Ads remarketing audience
  sync (P1), Google product-category auto-mapping from product type (P2),
  supplemental feeds (P2), product-selection/choose-which-sync (P2), multi-country
  & multi-language feeds (P2).
- YouTube Shopping product tags, local inventory ads, GMC performance dashboards,
  automated GTIN lookup (P3).
- The Web Pixels API itself — this app **consumes** it; if it is unavailable at
  build time, GA4/Ads pixel registration degrades to `pending_api` rather than
  blocking the build (see dependency flag).
