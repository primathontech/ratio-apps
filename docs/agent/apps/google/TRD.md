# TRD — Google (`google`)

Technical design for the `google` vendor app, derived from the approved
`docs/agent/apps/google/PRD.md`. Matches the repo's golden-path module recipe
(`apps/backend/src/modules/_template/`) and admin pattern. No code here — design
only, for GATE 2 sign-off.

## 0. Key technical decisions (carried from GATE 1)

- **GA4 + Google Ads = client-side pixels**, reusing the existing
  `ga4-pixel-sdk.js` and `google-ads-pixel-sdk.js` IIFE adapters. Config moves
  env-var → `google_configs` DB row, injected as a JS prelude.
- **Dual pixel-delivery path** (resolves the Draft Web Pixels API risk):
  1. **Script-tag delivery (ships now)** — `GET /google/sdk/:merchantId.js`
     serves `prelude + ga4 adapter + ads adapter`, exactly like the `_template`
     SDK pattern. Works today, no Web Pixels API needed.
  2. **Web Pixels API registration (guarded)** — `POST /pixels` (`write_pixels`).
     When the Draft API is unavailable, the call is caught and the merchant's
     `ga4_pixel_status` / `ads_pixel_status` is set to `pending_api`; the
     script-tag path still functions, so nothing is blocked.
- **gtag isolation** — both adapters share `window.gtag`. GA4 registers with
  `isolated: false` (events fan out to all gtag destinations); Google Ads owns
  its own conversions via `send_to: conversionId/label`. This is the existing
  scripts' contract and prevents double-counting.
- **GMC feed sync = the dependency-free core**: `products/*` webhooks + initial
  full sync + hourly reconcile → Google Content API for Shopping v2.1.
- **One required core change** (generic, not a per-vendor fork): the per-module
  webhook dispatch must support **multiple handlers** (4 topics), see §4.2.

## 1. Module shape

`apps/backend/src/modules/google/` — mirrors `_template`, with vendor logic added.
DI tokens in `tokens.ts`; shared providers via `createAppProviders<GoogleDatabase>`.

```
google/
  google.module.ts            # wires controllers/providers + createAppProviders
  google.bootstrap.ts         # AppBootstrap: seed empty google_configs on install
  tokens.ts                   # GOOGLE_CRYPTO/RATIO/MERCHANTS/OAUTH/WEBHOOKS (+ GOOGLE_DB_TOKEN)
  guards.ts                   # GoogleMerchantTokenGuard, GoogleWebhookSignatureGuard
  kysely.module.ts            # GOOGLE_DB_TOKEN → per-module Kysely client (google_app DB)
  config/
    google-config.dto.ts      # re-exports shared zod input schema
    config.controller.ts      # GET/PUT google-config, GET defaults, POST validate-*
    config.service.ts         # CRUD on google_configs; encrypts gmc_service_account_key
  sdk/
    sdk.controller.ts         # GET /google/sdk/:merchantId.js  (script-tag delivery)
    sdk.service.ts            # render prelude + ga4 + ads adapters per merchant
    pixel-registration.service.ts  # guarded Web Pixels API POST /pixels (pending_api fallback)
    enhanced-conversions.ts   # SHA-256 PII hashing helpers (email/phone/name/address)
  gmc/
    content-api.client.ts     # Google Content API for Shopping v2.1 (auth via google-auth-library)
    product-mapper.ts         # Ratio product/variant → GMC product attributes (incl. India MRP)
    feed-sync.service.ts      # insert/update/delete + custombatch initial sync + status writes
    reconcile.service.ts      # @Cron hourly: list GMC vs Ratio, fix drift, write sync log
    feed.controller.ts        # GET feed summary/items (paginated, filterable), POST force-sync
  google-oauth/
    google-oauth.service.ts   # Google token exchange + refresh; store in google_credentials
    google-oauth.controller.ts # GET connect (redirect), GET callback (Google → us)
  merchants/merchants.controller.ts   # from template (health/status)
  oauth/oauth.controller.ts           # Ratio install OAuth callback (from template)
  webhooks/
    webhooks.controller.ts            # single inbound endpoint; dispatch by topic
    app-uninstalled.handler.ts        # disable pixels + mark merchant inactive
    product-created.handler.ts        # enqueue/sync product → GMC
    product-updated.handler.ts        # update product → GMC
    product-deleted.handler.ts        # delete product → GMC, mark feed item DELETED
  db/
    types.ts                          # GoogleDatabase (4 vendor tables + standard 3)
    migrations/0001_initial.ts        # standard 3 tables + google tables
```

**Vendor dependencies** (module-local; not in `core/`): `google-auth-library`
(OAuth token exchange/refresh + service-account JWT for Content API) and the
Content API accessed via `googleapis` *or* thin `fetch` wrapper — decided in TDD;
default to a thin typed `fetch` client to avoid the heavy `googleapis` bundle.

## 2. API routes

All under `/google/...`. Admin routes guarded by `GoogleMerchantTokenGuard`
(Ratio merchant token), webhook by `GoogleWebhookSignatureGuard` (HMAC), pixel JS
is public, OAuth callbacks are public (Google-initiated).

| Method | Path | Guard | Purpose | Req → Res |
|---|---|---|---|---|
| GET | `/google/api/defaults` | none | form defaults (countries, languages, conditions, GMC category list) | → defaults object |
| GET | `/google/api/google-config` | merchant | read merchant config (secrets redacted) | → `GoogleConfig` |
| PUT | `/google/api/google-config` | merchant | upsert config | `GoogleConfigInput` → `GoogleConfig` |
| POST | `/google/api/validate-ga4` | merchant | validate Measurement ID format `G-*` | `{measurementId}` → `{ok}` |
| POST | `/google/api/validate-ads` | merchant | validate Conversion ID + Label format | `{conversionId,label}` → `{ok}` |
| POST | `/google/api/validate-gmc` | merchant | test Content API call w/ service-account key | `{merchantId,key}` → `{ok,accountName?}` |
| GET | `/google/api/feed/summary` | merchant | synced/warning/error counts, last sync, next reconcile | → summary |
| GET | `/google/api/feed/items` | merchant | per-product feed rows, filter by status, paginated | `?status&page&limit` → `{items,total}` |
| GET | `/google/api/feed/history` | merchant | recent `google_sync_log` rows | → `{entries}` |
| POST | `/google/api/feed/sync` | merchant | force a manual full sync | → `{started:true}` |
| GET | `/google/sdk/:merchantId.js` | none | script-tag pixel delivery (prelude + GA4 + Ads) | → `application/javascript` |
| GET | `/google/api/v1/oauth/callback` | none | Ratio install callback (template) → set cookie, redirect | — |
| GET/DELETE | `/google/api/v1/oauth/install/session` | none | bridge install cookie → admin (template) | → `{merchantId}` |
| GET | `/google/api/v1/google-oauth/connect` | merchant | begin Google OAuth (redirect to Google consent) | → 302 |
| GET | `/google/api/v1/google-oauth/callback` | none | Google → us; exchange code, store tokens, kick initial sync | → 302 to admin |
| POST | `/google/api/v1/oauth/webhook` | hmac | inbound Ratio webhook (single endpoint, dispatched by topic) | envelope → `{ok}` |

## 3. Data model / DB schema

One database per module: `google_app`. Standard `merchants`, `oauth_tokens`
(Ratio), `webhook_log` created exactly as in `_template/db/migrations/0001`. Plus
the four vendor tables from the PRD. Column naming snake_case in SQL, camelCase in
the Kysely `GoogleDatabase` interface (repo convention). `0001_initial.ts` creates
all of it.

**`google_configs`** (PK `merchant_id`, FK→merchants cascade): all GA4/Ads/GMC
settings and sync flags per the PRD table. `gmc_service_account_key` is `text`
holding the **CryptoService-encrypted** JSON key (never stored plaintext).
`ga4_pixel_status`/`ads_pixel_status` enums `active|pending_api|error|disabled`.

**`google_credentials`** (PK `merchant_id`, FK→merchants cascade): Google OAuth
tokens, **distinct** from Ratio `oauth_tokens`. `access_token`/`refresh_token`
stored encrypted (CryptoService); `expires_at` drives refresh; `granted_scopes`.

**`google_feed_items`** (PK `id` bigint auto; UNIQUE `(merchant_id, offer_id)`;
index `(merchant_id, status)` for the filtered feed view): per product/variant
status (`SYNCED|PENDING|ERROR|WARNING|DELETED`), `has_gtin`, `issue`, cached
`title`, `last_synced_at`.

**`google_sync_log`** (PK `id` bigint auto; index `(merchant_id, created_at)`):
sync-history rows (`sync_type`, counts, `detail`).

`Generated<>`/`ColumnType<>` typing follows `_template/db/types.ts`. Booleans are
MySQL `TINYINT(1)` → coerce `Boolean(row.x)` on read (template precedent).

## 4. Ratio integration

### 4.1 Scopes (verified against platform docs)

- `read_products` — product catalog for GMC sync + required scope for `products/*`
  webhooks (`codegen_ready: true`).
- `write_pixels` — Web Pixels API registration (Draft; guarded).
- `read_pixels` — read pixel status for admin health cards.
- `read_customer_events` — pixel event health/logs.

### 4.2 Webhooks — **requires a generic core enhancement**

Topics: `app/uninstalled`, `products/create`, `products/update`, `products/delete`
(verified to exist; HMAC-SHA256 via `X-Ratio-Hmac-SHA256`; 3 retries 5s/30s/5m).

The core `WebhooksService` + `createAppProviders` currently accept a **single**
`handler` matched by exact `handler.topic === envelope.event`. This app needs four
handlers. **Design:** generalize core to accept `handlers: WebhookHandler[]` and
match by a `Map<topic, handler>` (single-handler call sites, incl. `_template`,
pass a one-element array — backward compatible). This is a **generic capability**,
not vendor-specific logic in core, so it respects the `core/` boundary. To be
explicitly approved at GATE 2 since it touches `core/`.

- `app/uninstalled` → `GoogleAppUninstalledHandler`: set pixel statuses `disabled`,
  flip `merchants.is_active=false` (writes via `trx`, template pattern).
- `products/create` → transform via `product-mapper` → `feed-sync.upsert` → GMC
  insert; upsert `google_feed_items`.
- `products/update` → transform → GMC update; refresh feed item status.
- `products/delete` → GMC delete; mark feed item `DELETED`.

**Open verification (R1):** the envelope `event` string format. `_template`'s
uninstall handler uses `'app.uninstalled'` (dot) but platform docs list
`app/uninstalled` (slash). The handler `topic` constants must match whatever the
runtime actually sends — confirmed empirically in TDD before wiring (a wrong topic
silently no-ops via the mismatch fast-path).

Webhook handlers must finish cheap synchronous DB work within 5s. GMC API calls are
network-bound, so handlers **write the feed item as `PENDING` + enqueue**; the
actual Content API push happens just after (same request, post-200, or via the
sync service) — never blocking the 200 response past the budget. Final mechanism
(inline-after-ack vs. lightweight queue) pinned in TDD.

### 4.3 OAuth — two distinct flows

1. **Ratio install OAuth** (template, unchanged): merchant installs → Ratio
   redirects to `/google/api/v1/oauth/callback` → `OAuthService.handleCallback`
   runs `GoogleBootstrap` (seeds `google_configs`) inside the install trx → cookie
   → redirect to admin. Never hand-rolled.
2. **Google OAuth** (new, vendor): admin "Connect Google" → `/google-oauth/connect`
   builds Google consent URL (scopes `analytics.edit`, `adwords`, `content`) →
   Google → `/google-oauth/callback` exchanges code via `google-auth-library`,
   stores encrypted tokens in `google_credentials`, then kicks the initial full
   catalog sync. Token refresh on `expires_at`; refresh failure surfaces a
   "Reconnect" state in the config payload.

### 4.4 Outbound calls

- **Ratio API** (`RatioClient`, merchant Ratio token): `GET /api/v1/products`
  (paginated) for initial sync + reconcile.
- **Google Content API v2.1** (service-account JWT *or* OAuth token):
  `products.insert/update/delete`, `products.custombatch` (chunks of 1000 for
  initial sync), `products.list` (reconcile). India `maximumRetailPrice` mapped
  from `compare_at_price`.

## 5. Config model

Shared Zod schema `packages/shared/schemas/google-config` (mirrors
`_template-config` re-export pattern; compiled against Zod 3 in shared, consumed as
a type in the Zod-4 backend to avoid the inference mismatch — template precedent):

- `GoogleConfigInput` (PUT body) and `GoogleConfig` (GET response, secrets
  redacted — `gmc_service_account_key` returned as a boolean `hasGmcKey`, never the
  value). Fields map 1:1 to `google_configs` non-secret columns + the GA4/Ads/GMC
  toggles, target country/language/currency, defaults, and sync flags.
- Validators: `ga4_measurement_id` matches `^G-[A-Z0-9]+$`; `ads_conversion_id`
  numeric (optionally `AW-` prefixed per the script); `gmc_merchant_id` numeric.
- Constants (countries, languages, conditions, a starter Google product-category
  list) in `packages/shared/constants/google-*`, served by `GET /defaults`.

## 6. Non-functional requirements

- **Env keys** (derived from slug `google`): `RATIO_GOOGLE_CLIENT_ID`,
  `RATIO_GOOGLE_CLIENT_SECRET`, `RATIO_GOOGLE_CALLBACK_URL`,
  `RATIO_GOOGLE_DATA_ENCRYPTION_KEY` (base64, 32 bytes for AES-256),
  `RATIO_GOOGLE_ADMIN_BASE_URL`, plus Google app creds
  `RATIO_GOOGLE_GOOGLE_CLIENT_ID` / `_GOOGLE_CLIENT_SECRET` /
  `_GOOGLE_REDIRECT_URI` (Google's OAuth client — name disambiguation finalized in
  scaffolder). Added to `apps/backend/src/config/apps.ts` `APPS` tuple + wired in
  `app.module.ts`; `env.schema.ts` derives keys automatically.
- **Security**: HMAC-SHA256 webhook verification (`GoogleWebhookSignatureGuard`
  over raw body). All secrets (GMC service-account key, Google access/refresh
  tokens) encrypted at rest via per-module `CryptoService`. Secrets never returned
  by GET endpoints, never logged (structured logs redact `key`/`token`/`secret`).
  Pixel JS sets `Cache-Control` only on the success path (template precedent) to
  avoid CDN-poisoning 404s during install races.
- **Pagination/limits**: feed-items endpoint capped at `limit<=100`; Content API
  batch chunks of 1000; webhook payload cap 64 KB (core default).
- **Scheduling**: hourly reconcile needs a scheduler — add `@nestjs/schedule`
  `ScheduleModule` + a `@Cron('0 * * * *')` in `reconcile.service.ts`, iterating
  active merchants with `gmc_enabled` + `hourly_reconcile_enabled`. **R2:** confirm
  no existing global scheduler / that per-pod cron is acceptable (multi-pod → guard
  with a DB advisory lock or single-runner flag). Resolved in TDD.
- **Performance budgets**: webhook handler ≤5s (push deferred, see §4.2); GA4/Ads
  delivery rate >99%; reconcile bounded by Content API quota (exponential backoff
  on 429).
- **Idempotency**: GMC writes keyed by deterministic `offerId`
  (`{storePrefix}:{variantId|productId}`) so retries/reconcile are upserts.

## 7. Open questions / risks

| # | Item | Resolve by |
|---|---|---|
| R1 | Exact webhook `event` string format (`app/uninstalled` vs `app.uninstalled`, `products/create` vs `products.create`) — wrong topic silently no-ops. | TDD (empirical) |
| R2 | Hourly reconcile scheduler: add `@nestjs/schedule`; multi-pod single-runner guard. | TDD |
| R3 | Web Pixels API (`POST /pixels`) is Draft & `codegen_ready:false` — registration guarded to `pending_api`; script-tag path is the working fallback. | Built-in (guarded) |
| R4 | Google OAuth app review + Google Ads/GMC API access can lag — manual config (service-account key) is the always-available path. | Product (manual-first) |
| R5 | Webhook push vs 5s budget: inline-after-ack vs lightweight queue for the Content API call. | TDD |
| R6 | `googleapis` SDK (heavy) vs thin typed `fetch` client for Content API. Default: thin fetch. | TDD |
| R7 | GMC product images must be stable public URLs (Shopify-CDN-vs-Ratio-CDN during migration, source PRD Q5). | Product |
| R8 | Initial full sync for very large catalogs (10k+) — batch + progress surfaced in admin; bound memory. | TDD |
