# TRD — Delhivery Direct (`delhivery`)

> Technical Requirements / Design Document. Produced by `trd-architect` from the
> approved PRD, human-approved at **GATE 2** before the test plan.

**Source PRD:** `docs/agent/apps/delhivery/PRD.md`
**Status:** draft
**Closest reference:** `apps/admin-google` + `apps/backend/src/modules/google` (carrier vendor, `hasStorefrontSdk:false`). Thin, **direct** model — **no Ratio Fulfillment Service**; the module DB is the shipment record.

## 1. Module shape

`DelhiveryModule` wired via `createAppProviders('delhivery', …)` in `apps/backend/src/core/factories/app-module.factory.ts` (registered in `APPS` + `app.module.ts` `REGISTERED_MODULES`). Mirrors `modules/_template` / `modules/google`. **Never forks `core/`.**

- **Controllers**
  - `DelhiveryConfigController` — merchant config CRUD + test-connection.
  - `DelhiveryServiceabilityController` — pincode serviceability (Checkout-facing).
  - `DelhiveryShipmentController` — shipments list/detail, label proxy, manual create, pickup.
  - `DelhiveryWebhookController` — Ratio webhook receiver (HMAC-verified via core).
- **Services**
  - `SdkService` — **the carrier adapter** (Delhivery Express B2C calls) — this is the `// TEMPLATE:` spot in `sdk/sdk.service.ts`. Auth `Authorization: Token`.
  - `ConfigService` — read/write `delhivery_configs` (token encrypted at rest).
  - `ShipmentService` — create/persist shipments, mirror summary to the order.
  - `TrackingService` — normalize Delhivery status → Ratio status; dedupe.
  - `ServiceabilityService` — serviceability + 6h cache.
- **Async workers / cron** (mirror Google's `ProductSyncWorker` + hourly reconcile)
  - `ShipmentCreateWorker` — SQS consumer: builds package + calls Manifestation → AWB (triggered by `orders/paid`).
  - `TrackingReconcileCron` — polls Delhivery tracking for in-flight AWBs; primary tracking mechanism (poll-first).
  - `PickupCron` — daily at `pickup_cutoff`, calls Manifest/Pickup API for pending shipments.

## 2. API routes

| Method | Path (`/delhivery/...`) | Auth guard | Request | Response | Purpose |
|---|---|---|---|---|---|
| GET | `/config` | merchant/admin | — | config (token masked) | load Config screen |
| PUT | `/config` | merchant/admin | config fields | ok | save config (token encrypted) |
| POST | `/config/test` | merchant/admin | — | `{ok, warehouses?}` | test Delhivery token |
| GET | `/serviceability` | Checkout (see §7 open) | `pincode, order_value, cod` | `{serviceable, cod_available, edd_min, edd_max, carrier}` | checkout serviceability (6h cache) |
| GET | `/shipments` | merchant/admin | `page, status` | shipment list | Shipments screen |
| GET | `/shipments/:id` | merchant/admin | — | shipment + tracking timeline | detail |
| POST | `/shipments` | merchant/admin | `{order_id}` | shipment | manual AWB (manual mode) |
| GET | `/shipments/:awb/label` | merchant/admin | — | PDF stream | label proxy |
| POST | `/pickup` | merchant/admin | `{date?}` | `{scheduled}` | manual "Request Pickup" |
| POST | `/webhooks/ratio` | HMAC (core) | Ratio webhook | 200 | app/uninstalled, orders/paid, orders/cancelled, orders/edited |
| GET | `/oauth/callback` | core | install code | redirect | merchant-initiated install (core bootstrap) |

## 3. Data model / DB schema

One database per module: **`delhivery_app`** (Kysely + MySQL). Standard core tables `merchants`, `oauth_tokens`, `webhook_log` + vendor tables (`db/migrations/0001_initial.ts`):

- **`delhivery_configs`** — PK `merchant_id`; `api_token` (🔒 encrypted), `pickup_location_name`, `gstin`, `pickup_cutoff`, `awb_trigger` enum, `default_box_l/b/h_cm`, `enabled`.
- **`delhivery_shipments`** — PK `id`; `merchant_id` (idx), `order_id`, **`order_number` (UNIQUE per merchant — idempotency)**, `awb` (idx/unique), `carrier`, `status`, `payment_mode`, `cod_amount`, `weight_grams`, `label_url`, `estimated_delivery`, `active`, `created_at`.
- **`delhivery_tracking_events`** — PK `id`; `awb` (idx), `raw_status`, `unified_status`, `location`, `event_ts`, `created_at`; unique `(awb, unified_status)` for dedupe.

**Mirror to platform order** (not a table): `PATCH /orders/{id}` → `fulfillment_status` + `tracking_number`/`carrier` (native pref / metafields interim) + `PATCH /orders/{id}/external-id`.

## 4. Ratio integration

- **Scopes:** `read_orders`, `write_orders`, `read_products`.
- **Webhook topics + handlers** (via core `WebhookHandler`):
  - `app/uninstalled` → mark merchant inactive (default).
  - `orders/paid` → guard `order.source` (Ratio storefront) + dedupe `order_number` → **enqueue `ShipmentCreateWorker`** (if `awb_trigger=auto`).
  - `orders/cancelled` → cancel AWB (pre-pickup) / mark `shipment_cancelled`.
  - `orders/edited` → address/COD change pre-pickup → cancel + recreate.
- **OAuth / install:** merchant-initiated; core-provided callback + token bootstrap (never hand-rolled). App must be **approved/published** so tokens carry the scopes (§7).
- **Verified webhook payload contracts** (platform OpenAPI spec, `farzi/webhooks/order-created`):
  - `order-created`/`orders-paid` payload = a **flat order object** with keys: `id` ("ordr_…"), `order_number`, `email`, `confirmed` (bool), `created_at`, `currency`, `total_price`, `current_subtotal_price`, `financial_status` (e.g. `"paid"`), `fulfillment_status`, `status`, `name`, `phone`, `customer` {obj}, `billing_address` {obj}, `shipping_address` {obj}, `line_items` [array]. **No `source` field** in the spec — the orders/paid source guard therefore skips only when `source` is present AND non-Ratio (absent ⇒ processed; the worker's `awb_trigger` + `order_number` idempotency guards still apply).
  - `order-cancelled` payload = `{ orderId, externalOrderId }` (camelCase, IDs only — NOT the full order). The cancelled handler keys on `orderId` with snake_case (`order_id`/`external_order_id`) and full-order (`id`) fallbacks.
  - Core `envelopePayload()` is now **wrapper-tolerant**: returns `product`, else `order`, else — when the envelope root itself looks like an order (`id` + any of `financial_status`/`line_items`/`shipping_address`/`order_number`) — the envelope with the meta keys (`event_type`, `merchant_id`, `product`, `order`) stripped. Handles both `order`-wrapped AND flat deliveries; `deriveWebhookId`/`dedupeKey` work over both.
  - ⚠️ The **exact envelope wrapper must still be confirmed on a live delivery** (via `webhook_log`) — the spec shows the order object but not whether the platform nests it under `.order` or delivers it flat alongside `event_type`/`merchant_id`.

## 5. Config model

`packages/shared` → `delhivery-config` **Zod schema** (mirrors `_template`/`google` config):
```
apiToken: string (secret)      pickupLocationName: string
gstin: string                  pickupCutoff: string (HH:mm, default "10:00")
awbTrigger: "auto" | "manual"  defaultBox: { l: number, b: number, h: number }
enabled: boolean
```
Per-product package dims live as **Product/Variant `metafields`** (`length_cm`/`breadth_cm`/`height_cm`); `hs_code` already on the product; weight `grams ÷ 1000`.

## 6. Non-functional requirements

- **Env keys:** `RATIO_DELHIVERY_*` — `DATABASE_URL`, `DATA_ENCRYPTION_KEY`, `CLIENT_ID`, `CLIENT_SECRET`, `CALLBACK_URL`, `ADMIN_BASE_URL` + `DELHIVERY_API_BASE` (staging/prod host).
- **Security:** HMAC verification on inbound Ratio webhooks (core); **`api_token` encrypted at rest** (`DATA_ENCRYPTION_KEY`); Delhivery token only server-side (label = backend proxy). Never log token/PII.
- **Idempotency:** Delhivery `order` = Ratio `order_number`; persist shipment before retry; Delhivery rejects duplicate `order`.
- **Resilience:** AWB create retry 3× exp-backoff; Delhivery `429` → per-merchant queue/backoff; tracking poll cron (interval) is primary + backstop.
- **Caching:** serviceability 6h TTL per pincode.
- **Limits/pagination:** shipments list paginated.
- **Performance:** `orders/paid` → AWB p95 **< 30s** (async worker); serviceability non-blocking at checkout.
- **KwikEngage events fired app-side** (7 shipping events not in platform catalog).

## 7. Open questions / risks

> **Verification approach:** the webhook/contract items below (signature header, `orders/cancelled` shape, `source`, COD field, envelope) are verified on a **live delivery** once the app has a build version + an authorized merchant (see the verified recipe below). Code is already **tolerant** of the variations, so unknowns don't block the build.

**✅ OAuth + scopes: RESOLVED & verified end-to-end on QA (2026-07-02).** Base host: **`qa-os-ecosystem.dev.gokwik.io/api/v1`**. The verified unblock recipe:
1. **Declare scopes** on the app → `PATCH /applications/{appId}` `{scopeIds:["read_orders","write_orders","read_products"]}` (writes `application.scopes`). The portal "Save Changes" writes the same record.
2. **Upload a build version** → `POST /applications/{appId}/upload-build` (multipart `buildZip=@app.zip`). **This step ACTIVATES the scopes for the OAuth layer** — before a version exists, `oauth/app-info` + `oauth/authorize` report **zero** declared scopes and reject them ("Requested scopes are not declared by the app"); after, they see all three. Scopes come from `application.scopes`, NOT the ZIP — our ZIP had no manifest (`manifestJsonb:null`) yet scopes activated, so a version merely needs to **exist**.
3. **Authorize** (no browser needed on QA) → `POST /oauth/authorize` `{clientId, merchantId, scopes}` → returns `{code}` (the docs' GET authorize is a placeholder host; QA only has POST). Only `clientId`+`merchantId` are required.
4. **Exchange** → `GET /oauth/internal-exchange?code=…` (or `POST /oauth/token`) → token with `scope: READ_ORDERS,WRITE_ORDERS,READ_PRODUCTS`.
5. **Call the API** → `GET /api/v1/orders` with `Authorization: Bearer <token>` → ✅ returns orders (no 403). (`/merchants/orders` from the FAQ is a placeholder → 404; real path is `/orders`.)
- **Draft is sufficient** — no Review/Publish needed to get a scoped token + read orders (matches the FAQ "draft mode can test OAuth/API/webhooks"). Approval only gates the public store listing.

**Publishing / install model (learned 2026-07-02):**
- **P1. Build/version is functionally required (not cosmetic).** Uploading a version activates scopes (verified) and almost certainly webhooks/extensions for the OAuth runtime. The **ZIP manifest** (`manifestJsonb`) is still unmapped — it likely declares **extensions** (embedded-UI bundles, per the `versions/{id}/extensions/*` endpoints) and possibly webhook subscriptions. Open ask: the manifest schema. `appKind:embedded`, `appType:public`.
- **P2. Real deploy URL** — the OAuth `redirectUri` + webhook endpoint must be our **deployed** public backend URL (per `DEPLOY.md`), not a throwaway tunnel. (The app's registered `redirectUri` was `http://localhost:3000/callback`.)

**Webhook delivery model — verified live on QA (2026-07-02/03):**
- **Two layers.** *Developer defaults* (`app-webhooks/developer/{appId}`) are templates. Actual delivery uses *per-merchant active subscriptions* (`app-webhooks/merchant/{merchantId}` / `app-webhooks/app/{appId}`), created from the defaults at install time (snapshotting the default URL then). Editing defaults does **not** retro-update existing per-merchant subs.
- **🔑 The HMAC secret is the per-webhook `secretKey` WE set at registration** (`CreateWebhookDto.secretKey`), delivered as `hasSecretKey:true` — **NOT** the OAuth `client_secret`. → **core `webhook-signature.guard.ts` must verify against the per-webhook secretKey, not `client_secret`** (current guard comment/behaviour is wrong on this). Register per-merchant subs with the merchant token: `POST /app-webhooks {eventName, webhookUrl, secretKey, customHeaders}`.
- **⚠️ Manual dashboard "mark as paid" (draft→paid) does NOT emit `orders/paid`.** Verified: created + marked-paid two orders on `190a87z54kcf` with an **active** `orders/paid` sub → subscription showed `lastSuccessAt/lastFailureAt=null, failureCount=0` (**zero dispatches** — event never fired, not a delivery failure). ⇒ `orders/paid` only fires from the **real checkout/payment pipeline** (Kwik Checkout completing payment), not a manual status flip. **Live webhook capture must use a real checkout order** (deferred to proper QA). Open ask to platform: *which order-state transitions emit `orders/paid` to app webhooks?*

**Webhook payload contract — docs read 2026-07-02 (`qa-developers…/docs/webhooks/overview`), verify on a real-checkout delivery:**
- ✅ **Order events are FLAT** — full order object + top-level `event_type` + `merchant_id`; **no `order` wrapper** (products/collections/reviews DO wrap under their key). Matches our tolerant `envelopePayload`.
- 🔴 **Signature scheme — CORRECTED (os-devecosystem docs, 2026-07-04; the `devecosystem.dev.gokwik.in` platform our app uses):** the real dispatcher signs **`HMAC-SHA256(secret, "${timestamp}.${json}")`** and sends headers **`X-Webhook-Signature` + `X-Webhook-Timestamp` + `X-Webhook-Id`**. This contradicts BOTH the public dev-docs (`x-ratio-signature`, raw-body) AND our core guard (`x-ratio-hmac-sha256`, raw-body) — **so the current guard rejects every real webhook** (wrong header AND wrong signed input: it must hash `timestamp + "." + rawBody`, not rawBody alone). **Fix `core/webhooks/webhook-signature.guard.ts`:** read `X-Webhook-Signature`, verify `HMAC-SHA256(secret, \`${X-Webhook-Timestamp}.${rawBody}\`)`. **Still to confirm (low-confidence, on a live delivery or os-devecosystem source):** which secret (per-webhook `secretKey` vs `client_secret` vs global), digest encoding (hex/base64) + any prefix. Non-blocking in dev (`WEBHOOK_SIGNATURE_OPTIONAL=true`).
- ⚠️ **`orders/cancelled` shape** — docs say full flat order (with `status:"cancelled"`, `cancelled_at`, `cancel_reason`); OpenAPI spec said `{orderId, externalOrderId}`. Contradiction; handler tolerates both — confirm on live delivery.
- ⚠️ **`source` / COD** — the doc example order has **no `source`** field and no explicit COD flag (carries `payment_gateway_names` + `financial_status`). Confirm the COD signal on a live COD order.
- 🔴 **Webhook `line_items` carry NO weight/`hs_code`/dimensions** — the `ShipmentCreateWorker` must fetch weight + `hs_code` + dim metafields from the **Product/Variant API** (`read_products`), not from the webhook payload.

1. **Serviceability consumption (GoKwik Checkout)** — ✅ **RESOLVED (confirmed with platform team, 2026-07-03): via a storefront SDK.** Ship `packages/delhivery-sdk` (`hasStorefrontSdk:true`): a headless **client** (`window.RatioDelhivery.checkServiceability(pincode)`) as the primary integration + an optional `<delhivery-serviceability>` widget, served by the per-merchant **loader** (`/delhivery/sdk/<merchantId>.js`). It calls the **public** `GET /delhivery/api/serviceability` endpoint (no merchant-token guard — merchant identified by `merchantId`; `Access-Control-Allow-Origin: *` already set for browser callers). REDESIGN vs the search-oriented `_template`/`wizzy` SDK — drop `results`/`recent-store`/`anon-id`. *(Assumption to confirm: SDK load mechanism = per-merchant loader script vs platform checkout-extension bundle.)*
2. **How the platform delivers `orders/*` webhooks** — ✅ **mechanism RESOLVED** (see "Webhook delivery model" above): self-serve register (UI or `app-webhooks` API) → per-merchant active subscriptions → HMAC via our `secretKey`. Remaining = only a **live capture from a real-checkout order** to confirm the signature header + `orders/cancelled` shape (manual mark-as-paid won't trigger it).
3. **COD-vs-Prepaid** — ✅ **RESOLVED (docs-verified, 2026-07-04).** GoKwik os-order has a canonical **`payment_method` (`prepaid`|`cod`)**; there is **no dedicated COD boolean/amount** in the order payload. COD is never pre-collected → **`financial_status` = `pending`/`unpaid`** (Prepaid = `paid`/`authorized`). `mapPaymentMode` now keys on: `payment_method`/descriptors + **`payment_gateway_names[]`** containing "cod"/"cash on delivery", OR `financial_status` ∈ {pending, unpaid} → COD (else Prepaid); `cod_amount` = order total. Residual (verify on a real COD order, not a blocker): the exact `payment_gateway_names` COD string + whether `payment_method` is surfaced in the webhook payload.
4. **`order.source` value** for Ratio-origin orders (`"Online Store"` seen) — guard.
5. **AWB mirror on the order** — native `tracking_number`+`carrier` (preferred; Backend Core additive) vs order `metafields` (interim).
6. **Delhivery test creds** — staging token + test warehouse (`clientservice@delhivery.com`).
7. **App approval/scopes gate** — ✅ **RESOLVED** (see verified recipe above): empty scopes were caused by **no build version**, not lack of approval. Declare `application.scopes` + upload a version → scoped token issues in **draft**. No approval needed for testing.
8. **Package bin-packing** — multi-item → one box: size-tier / default-box heuristic for v1 (not exact packing).
