# TDD — Google (`google`)

Test plan derived from the approved PRD + TRD. Written before implementation so
the build is test-driven: `backend-builder` / `frontend-builder` write each failing
test first, then implement to green. Runner: **Vitest**. The heavy e2e/Built-for-
Ratio QA suite is intentionally out of scope here.

## 1. Test strategy

- **Unit (majority).** Pure logic and services with mocked edges:
  - Shared Zod schema (`google-config`) — `packages/shared/src/schemas/google-config.test.ts`.
  - Backend services — `apps/backend/test/unit/apps/google/*.test.ts`. DB mocked
    via the existing fake-Kysely helper used by `webhooks.service.test.ts`; Ratio
    API via a fake `RatioClient`; Google Content API + Google OAuth via injected
    fake HTTP clients (no network).
  - Core multi-handler dispatch — extend `apps/backend/test/unit/core/webhooks.service.test.ts`.
- **Integration (light, in-process).** Nest `Test.createTestingModule` for each
  controller with services mocked, asserting routes/guards/validation wiring. No
  real MySQL, no real Google.
- **Frontend.** Vitest + Testing Library under `apps/admin-google/src/**`, fetch
  mocked.
- **Mocked, never hit for real:** Ratio API, Google Content API, Google OAuth
  endpoints, Web Pixels API (`POST /pixels`), MySQL, network, clock (`vi.useFakeTimers`
  for refresh-expiry and reconcile-cron cases), `crypto` is real (round-trip tested).
- **Determinism:** SHA-256 hashing asserted against precomputed golden digests;
  no `Date.now()`/random in assertions except via fake timers.

## 2. Acceptance criteria → test mapping

| # | PRD acceptance criterion | Test case(s) |
|---|---|---|
| AC1 | Manual config (GA4/Ads/GMC) validates + persists, secrets encrypted | `config.service: upsert encrypts gmc key`; `config.service: get redacts gmc key → hasGmcKey`; `validators: GA4/Ads/GMC format accept+reject`; `validate-gmc: test API call ok/fail`; `google-config schema: accept/reject`; FE `ConfigForm: validation + submit` |
| AC2 | OAuth connect; Google tokens encrypted; auto-refresh; reconnect on refresh failure | `google-oauth.service: exchange stores encrypted tokens`; `…: refresh when expired`; `…: refresh failure → needsReconnect`; `config.get exposes needsReconnect`; integration `google-oauth.controller: connect 302 / callback stores+redirects` |
| AC3 | GA4+Ads config persists; SDK wiring present; pixel registration → `pending_api` when API absent | `sdk.service: render returns prelude+ga4+ads`; `sdk.service: isolation flags`; **`ga4-adapter: event-mapping matrix (13 events)`**; **`ga4-adapter: isolated flag send_to`**; **`google-ads-adapter: conversion-mapping matrix`**; **`adapters: GA4+Ads co-existence no double-count`**; `pixel-registration: success sets active`; `pixel-registration: API unavailable → pending_api (no throw)`; integration `sdk.controller: serves JS / 404 inactive / 404 unconfigured` |
| AC4 | Enhanced conversions toggle; hashed PII per mapping | `enhanced-conversions: sha256 email/phone/name lowercased+trimmed (golden)`; `…: country plaintext ISO`; `…: omits absent fields`; `sdk.service: prelude includes user_data only when enabled`; `google-ads-adapter: user_data hashed payload on conversion when enabled` |
| AC5 | `products/*` webhooks transform (variants→itemGroupId) + GMC insert/update/delete, update feed items | `multi-handler dispatch: routes create/update/delete/uninstall`; `product-created.handler: upsert PENDING→insert→SYNCED`; `product-updated.handler: update`; `product-deleted.handler: delete + mark DELETED`; `product-mapper: variants→separate offers + itemGroupId` |
| AC6 | Initial full sync (batched) on connect; hourly reconcile fixes drift; both log | `feed-sync: initial custombatch chunks of 1000`; `reconcile.service: lists GMC vs Ratio, re-syncs drift, writes sync_log`; `feed-sync: each run appends google_sync_log` |
| AC7 | Mapping covers required attrs + India MRP; missing image/price→ERROR; missing GTIN→WARNING (identifierExists:false, SKU as mpn) | `product-mapper: required attrs present`; `…: compare_at_price→maximumRetailPrice (INR)`; `…: no image→ERROR`; `…: no price→ERROR`; `…: no barcode→WARNING + identifierExists:false + mpn=sku`; `…: HTML stripped`; `…: title>150 truncated` |
| AC8 | Feed-details shows per-product status/GTIN/issue + history; Force Sync triggers manual sync | `feed.controller: items paginated+filtered`; `…: summary counts`; `…: history rows`; `…: POST sync → started`; FE `FeedDetails: renders rows/filter/history`, `Dashboard: Force Sync calls API` |
| AC9 | `app/uninstalled` disables pixels + flips merchant inactive | `app-uninstalled.handler: sets pixel statuses disabled + is_active=false (via trx)`; `multi-handler dispatch: uninstall topic routes to handler` |
| AC10 | `pnpm -r lint && typecheck && build` (and `test`) pass | CI gate, §7 |

No orphan criteria; no orphan test groups.

## 3. Backend test cases

### 3.1 Core — multi-handler webhook dispatch (`core/webhooks.service.test.ts`, extended)
Backward-compat + new routing. **All existing single-handler cases must stay green.**
- `accepts a single handler (legacy shape) and behaves identically` — construct with the legacy `{ db, handler }`; assert the existing dispatch behavior unchanged (regression guard for `_template`).
- `accepts handlers[] and routes envelope.event to the matching handler` — 4 handlers; dispatch a `products/update` envelope → only that handler's `handle` called once.
- `unmatched topic across all handlers → no handler runs, processed_at stamped` — extends the existing mismatch fast-path assertion to the multi-handler map.
- `duplicate ratio_webhook_id → no handler runs (dedupe preserved)`; `handler throw → rollback (self-healing preserved)`; `passes open trx to the matched handler`.
- **R1 pin:** a `topic-format` table test asserting the handler `topic` constants equal the exact strings the runtime sends; a fixture documents the confirmed format (see Fixtures). A wrong constant must make `routes …` fail loudly, not silently no-op.

### 3.2 Config service (`apps/google/config.service.test.ts`)
- `upsert encrypts gmc_service_account_key` — spy CryptoService.encrypt; stored value ≠ plaintext; round-trips via decrypt.
- `get redacts secrets` — response has `hasGmcKey: true`, no `gmcServiceAccountKey`, no Google tokens.
- `get throws CONFIG_NOT_FOUND when no row`; `upsert is idempotent (ON DUPLICATE KEY)`.
- `boolean TINYINT coercion` — `Boolean(0/1)` for toggles on read.

### 3.3 Validators + validate endpoints (`apps/google/validators.test.ts`)
- GA4: accepts `G-ABC123`, rejects `GA-x`/empty. Ads: accepts numeric / `AW-123`, rejects alpha; label non-empty. GMC merchant id numeric.
- `validate-gmc: ok` — fake Content API returns account → `{ok:true, accountName}`.
- `validate-gmc: bad key` — client throws → `{ok:false, error}` (no 500 leak, key not logged).

### 3.4 Pixel SDK render (`apps/google/sdk.service.test.ts`)
- `render returns prelude + ga4 adapter + ads adapter` (both adapter bodies present).
- `prelude sets GA4 config isolated:false and Ads send_to=conversionId/label` (isolation contract).
- `enhanced-conversions user_data present only when enhanced_conversions_enabled`.
- `inactive merchant → 404 MERCHANT_INACTIVE`; `unconfigured → CONFIG_INCOMPLETE`; `Cache-Control only on success` (no header on error paths — template precedent).
- `safeInlineJson` used for the prelude (XSS golden, mirror `pixel-prelude.test.ts`).

### 3.5 Guarded Web Pixels API registration (`apps/google/pixel-registration.service.test.ts`)
- `success → POST /pixels called, ga4_pixel_id stored, status active`.
- `API unavailable (404/501/network) → caught, status pending_api, NO throw` (build/ship unblocked — R3).
- `write_pixels missing/forbidden → status error, logged`.

### 3.6 Enhanced conversions hashing (`apps/google/enhanced-conversions.test.ts`)
- Golden digests: `email` → sha256(lowercase+trim); `phone` → sha256(E.164); `first/last name` → sha256(lowercase+trim); `country` plaintext ISO-3166-1-alpha2.
- Omits fields absent on the event; never hashes empty string to a digest.

### 3.7 GMC product mapper (`apps/google/product-mapper.test.ts`)
- Required attrs present (offerId, title, description, link, imageLink, price+INR, availability, condition, brand, channel online, contentLanguage, targetCountry, identifierExists).
- `compare_at_price → maximumRetailPrice` (India) and `salePrice` when on sale.
- 3-variant product → 3 offers sharing `itemGroupId`, each with color/size from options.
- `no image → status ERROR (not synced)`; `no price → ERROR`; `no description → title fallback + WARNING`.
- `no barcode → WARNING + identifierExists:false + mpn=sku`; valid GTIN → `has_gtin:true`.
- HTML stripped from description; title > 150 chars truncated with ellipsis.
- `offerId = {storePrefix}:{variantId|productId}` deterministic (idempotency).

### 3.8 Feed-sync service (`apps/google/feed-sync.test.ts`)
- `upsert(create) → feed item PENDING then SYNCED on Content API ok`; `Content API rejects → ERROR + issue message`.
- `update → products.update called`; `delete → products.delete + item DELETED`.
- `initial full sync → products.custombatch in chunks of 1000`; appends `google_sync_log` with counts.
- `429 → exponential backoff/retry` (fake timers).
- **R5 pin:** webhook handler path returns/acks within budget — handler writes PENDING synchronously and the Content API push is invoked via the deferred path (assert handler does not await the network call inside the 5s-critical section; the chosen mechanism — inline-after-ack vs queue — is asserted here).

### 3.9 Reconcile service (`apps/google/reconcile.service.test.ts`)
- `@Cron hourly: products.list vs Ratio catalog → re-syncs drifted/missing, writes sync_log (sync_type=reconcile)`.
- `only runs for active merchants with gmc_enabled + hourly_reconcile_enabled`.
- `multi-pod single-runner guard` (R2) — second concurrent run is skipped (advisory-lock/flag), asserted via the guard seam.

### 3.10 Webhook handlers
- `app-uninstalled.handler` (AC9): sets `ga4_pixel_status/ads_pixel_status=disabled` and `merchants.is_active=false` via `trx`; already-inactive → no-op (retry-safe).
- `product-created/updated/deleted` (AC5): call mapper + feed-sync with the right op; unknown/dirty payload → safe no-op + log.

### 3.11 Google OAuth service (`apps/google/google-oauth.service.test.ts`)
- `exchange code → stores encrypted access+refresh in google_credentials`.
- `getValidToken: refreshes when expires_at passed` (fake timers); stores new token.
- `refresh failure → marks needsReconnect; config GET surfaces it` (AC2 reconnect).

### 3.12 Bootstrap + install (`apps/google/bootstrap.test.ts`)
- `GoogleBootstrap.run seeds an empty google_configs row` inside the install trx; reinstall preserves existing config (ON DUPLICATE KEY no-op, template precedent).

### 3.13 Controller/guard integration (`apps/google/*.controller.test.ts`)
- Config/feed routes reject without merchant token (guard), accept with it.
- Webhook route rejects bad HMAC signature (`GoogleWebhookSignatureGuard`), accepts valid; returns `{ok:true}` 200.

### 3.14 GA4 adapter event mapping (`apps/google/ga4-adapter.test.ts`)
Load the `ga4-pixel-sdk.js` IIFE into a JSDOM harness (`fakeRuntime` capturing
`analytics.subscribe(name, fn)`, `fakeGtag` recording every `gtag(...)` call,
stubbed `document.head.appendChild`). Register with `{ measurementId: 'G-TEST', isolated: false }`,
then fire each event and assert the emitted `gtag('event', <name>, <props>)`.
- `registers via runtime when __OPEN_STORE_PIXEL_RUNTIME__ present`; `queues to __OPEN_STORE_PIXEL_PENDING__ when runtime absent`.
- `register(): injects gtag.js once`; `reuses existing window.gtag (loaded by Ads)`; `gtag('config', mid, {send_page_view:true})`.
- **Event-mapping matrix** — one case per mapped event, asserting GA4 name + key params:
  - `ViewContent → view_item` (items[0] from content_ids/content_name, value, currency).
  - `AddToCart → add_to_cart` (items from contents via mapItems, value, currency).
  - `InitiateCheckout → begin_checkout` (items, value, currency, coupon when present).
  - `AddShippingInfo → add_shipping_info` (shipping_tier from shipping_method, value).
  - `AddPaymentInfo → add_payment_info` (payment_type from payment_method, value).
  - `Purchase → purchase` (transaction_id from order_id, value, currency, tax, shipping, coupon, items).
  - `Search → search` (search_term from search_string).
  - `AddToWishlist → add_to_wishlist`; `Lead → generate_lead`; `CompleteRegistration → sign_up` (method); `Contact → contact`; `Subscribe → subscribe`.
- `PageView is NOT manually subscribed` (relies on GA4 Enhanced Measurement + send_page_view) — assert no `page_view` subscription.
- `currency falls back to 'INR'` when `properties.currency` absent.
- **Isolation flag (AC3):** `isolated:true → every event payload carries send_to: measurementId`; `isolated:false (default) → no send_to` (fan-out so Ads/EC work).
- **Resilience:** a handler that throws (e.g. malformed event) is caught by `safeHandler` and does not break sibling subscriptions or throw out of the runtime.

### 3.15 Google Ads adapter conversion mapping (`apps/google/google-ads-adapter.test.ts`)
Same JSDOM harness; register with `{ conversionId: 'AW-123', events: { Purchase:'pl', AddToCart:'al', InitiateCheckout:'cl' }, defaultCurrency:'INR' }`.
- **Config validation guards:** `missing conversionId → aborts (no subscribe, logs error)`; `no labels/events → aborts`; invalid (non-string/empty) label is dropped with a warn.
- **Idempotency:** second `register()` is skipped via `__GOOGLE_ADS_SDK_REGISTERED__` (no double-subscribe → no inflated conversions).
- **gtag setup:** loads/reuses gtag; `gtag('config', conversionId, {send_page_view:false})` (does not hijack GA4 pageview).
- **Conversion-mapping matrix** — assert `gtag('event','conversion', payload)`:
  - `Purchase → send_to=conversionId/pl, value, currency, transaction_id=order_id`.
  - `AddToCart → send_to=conversionId/al, value, currency` (no transaction_id).
  - `InitiateCheckout → send_to=conversionId/cl, value, currency`.
  - only events present in the label map subscribe; unlabeled events do not fire.
- **Purchase without order_id:** still fires but logs a dedup warning (assert warn + that conversion still emitted).
- **`value` coercion:** non-finite/empty `value` is omitted (not sent as NaN/null); string numerics coerced.
- **PageView:** when `isolated` is falsy, subscribes `PageView → gtag('event','page_view', {send_to, page_title, page_location, page_referrer})`; when `isolated` truthy, no PageView subscription.
- **Co-existence with GA4 (the isolation contract, AC3):** with both adapters registered on a shared `window.gtag`, a single storefront `Purchase` yields exactly one GA4 `purchase` and one Ads `conversion` (no double-count); harness asserts the two distinct `gtag` calls.

## 4. Frontend test cases (`apps/admin-google/src/**`)

- `ConnectScreen`: shows OAuth button + manual form; switching method toggles fields.
- `ConfigForm` (per integration): client-side validation (GA4 `G-*`, Ads numeric, GMC id); disables Save until valid; PUT payload shape; secret field write-only (shows "configured" not the value).
- `Dashboard`: three status cards render Active/Pending API/Error/Disabled from config; "Force Sync Now" calls `POST /feed/sync`; "View Feed Details" navigates.
- `FeedDetails`: renders item rows (Product/Status/GTIN/Issue), status filter, pagination, sync-history list; empty + error states.
- `EnhancedConversionsToggle`: reflects + updates `enhanced_conversions_enabled`.
- `useInstallSession`: reads merchant id from `install/session` on mount, then DELETEs (template S4 pattern).

## 5. Shared-schema test cases (`packages/shared/src/schemas/google-config.test.ts`)

- Accepts a full valid config (all three integrations + sync flags) with defaults applied (country `IN`, language `en`, currency `INR`, condition `new`).
- Rejects bad GA4 id, bad Ads id, non-numeric GMC id, bad country/language codes.
- `category_mode` enum accept/reject; sync-flag booleans default correctly.
- Input vs output separation: output (GET) type has `hasGmcKey: boolean` and no secret fields.

## 6. Fixtures & helpers

- `fakeKysely` — reuse the existing fake-DB helper from `webhooks.service.test.ts`.
- `makeGoogleConfig(overrides)` — config-row factory; `makeMerchant({isActive})`.
- `makeRatioProduct(overrides)` — product w/ variants, images, barcode, compare_at_price; variants for color/size; edge fixtures: `noImage`, `noPrice`, `noBarcode`, `htmlDescription`, `longTitle`.
- `fakeContentApiClient` — records insert/update/delete/custombatch/list calls; programmable ok/reject/429.
- `fakeGoogleOAuthClient` — programmable token-exchange + refresh (success/failure).
- `fakeWebPixelsClient` — programmable available / unavailable.
- `webhookEnvelope(topic, data)` + signed-HMAC helper (reuse `webhook-signature.guard.test.ts` approach).
- `pixelHarness()` — loads a pixel IIFE under JSDOM with: `fakeRuntime` (records `subscribe(name, fn)` and exposes `emit(name, event)`), `fakeGtag` (records all `gtag(...)` calls + args), stubbed script injection, and a reset between cases. Drives both §3.14 and §3.15. `makeStorefrontEvent(name, properties, metadata)` builds sample analytics events (contents[], content_ids, value, currency, order_id, user_data).
- **R1 fixture:** `WEBHOOK_TOPICS` constant documenting the exact event strings the runtime sends (verified empirically during backend-builder); handler `topic` constants import from here so the format lives in one place.
- Golden digests file for §3.6 SHA-256 assertions.

## 7. Definition of done

- `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r build`, `pnpm -r test` all green.
- Every PRD acceptance criterion (AC1–AC10) has ≥1 passing test per §2.
- Existing core/`_template` tests remain green (multi-handler change is backward
  compatible).
- No secret value appears in any test snapshot, log assertion, or GET-response
  fixture.
- TRD open items pinned by tests: R1 (webhook event-string format, §3.1/Fixtures),
  R2 (reconcile single-runner, §3.9), R5 (push vs 5s budget, §3.8).
