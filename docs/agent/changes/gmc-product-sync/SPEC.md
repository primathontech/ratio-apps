# GMC product sync hardening + core webhook envelope fix — spec
- **Slug:** gmc-product-sync   **Type:** feature   **Size:** feature
- **Area:** backend (core/webhooks) + google app

## Problem / goal
Google Merchant Center (GMC) product sync is ~80% built (`google/gmc/*`, product
webhook handlers, `FeedSyncService`, force-sync via Content API `custombatch`),
but it was never verified against the **real** OpenStore/Ratio contracts. Verifying
the live API + webhook payloads (QA docs + a sample delivery) revealed the code is
wrong against reality in ways that make sync silently fail or corrupt prices:

1. **Core webhook envelope mismatch (affects ALL modules).** Real deliveries are
   `{ event_type, merchant_id, product }` (no top-level delivery `id`/`timestamp`).
   `core/webhooks/webhooks.types.ts` validates against `{ id, event, timestamp,
   merchantId, data }`, so `ZodValidationPipe` **400s every real webhook** before
   dispatch. The HMAC guard (`x-openstore-signature`, `sha256=`) is already correct.
   This resolves google TRD open item **R1** ("verify topics/envelope against a live
   delivery").
2. **Two different product shapes.** The REST list/get API and the webhook `product`
   object use different field conventions, and the code's single parser fits neither:
   - REST `GET /products`: `name`, `description`, `productType`, `variants[].id`,
     `variants[].sku`, `variants[].compareAtPrice`, `variants[].inventory.quantity`,
     `variants[].options{}`, `images[].src`. Envelope `{ success, data[], pagination }`.
   - Webhook `product`: `title`, `body_html`, `product_type`, `variants[].variant_id`,
     `variants[].sku_id`, `option1/2/3` (+ product-level `options[]`),
     `variants[].warehouseQt[].quantity`, `images[].url` (+ top-level `imageUrl`).
   Current `parseRatioProduct` requires `title`+`handle` and reads `variants[].id`,
   `.sku`, `.inventory_quantity`, `images[].src` — so it collapses all webhook variants
   to one id, drops SKUs, drops images, and the REST `RatioProductsService` zod schema
   fails outright on `name` (no `title`).
3. **Prices are rupees (major units), not paise.** Both surfaces send decimals
   (`29.99`, `199.99`). The code's `÷100` paise conversion makes every GMC price 100×
   too low. **This overturns the saved 2026-06-08 learning** (which said integer paise);
   the learning + `google/CONTEXT.md` must be corrected.
4. **No Ratio token refresh.** `RatioProductsService` uses the stored access token
   as-is; tokens expire ~1h and refresh tokens rotate (single-use). Force sync breaks
   after the first hour.
5. **Non-durable push.** Webhook handlers push to GMC via in-process `queueMicrotask`
   after the 200 ack — lost on pod crash.

Goal: make webhook-driven incremental sync and force/full sync correct, durable, and
aligned to the real contracts, while fixing the core webhook envelope once for all
modules.

## Approach

### Part 1 — Core webhook envelope (one-time, all modules)
- Change `webhookEnvelopeSchema` to the real shape: `event_type` (→ routing),
  `merchant_id` (→ merchantId), `product` (→ handler payload). Keep the 64 KB
  payload guard. Drop the `timestamp` skew check (no timestamp in the contract) or
  make it optional.
- **Idempotency / dedupe** = `(merchantId, product.id, event_type)` per docs, stored
  as a derived `ratioWebhookId = "${event_type}:${product.id}"` so the existing
  `webhook_log` UNIQUE column is reused with **no per-module migration**. Make dedupe
  **retry-windowed, not permanent**: an INSERT collision is treated as a duplicate
  retry only if the existing row was received within a configurable window (≥ the
  platform's ~2h retry tail); otherwise the event is processed again. Correctness rests
  on **idempotent handlers** (GMC insert=upsert, delete=idempotent), so reprocessing is
  always safe. (Builds on ADR-0001 multi-handler dispatch; preserves the transactional
  self-healing model.)
- Update the `WebhookHandler` call sites in all modules (google/meta/posthog/moengage,
  `_template`) to the new envelope; re-run each module's webhook tests.

### Part 2 — Google product normalization (two parsers)
- `parseWebhookProduct(product)` — webhook shape: `title`/`body_html`/`product_type`,
  variants keyed on `variant_id`, sku from `sku_id`, options from `option1/2/3` mapped
  to names via product `options[].name` by position, inventory = sum of
  `warehouseQt[].quantity`, images from `images[].url` (+ `imageUrl` fallback).
- `parseRestProduct(item)` — REST shape: `name`/`description`/`productType`, variants
  keyed on `id`, sku from `sku`, options from `variants[].options{}`, inventory from
  `inventory.quantity`, images from `images[].src`.
- Both emit the internal `RatioProduct`. **Prices pass through as rupees — remove the
  `paiseToMajor`/`÷100` conversion entirely.**
- `RatioProductsService`: parse the `{ success, data[], pagination }` envelope, page via
  `pagination.totalPages`, query `?status=active&published=true&show_variants=true`.

### Part 3 — Active+published filter & status transitions
- Force/full sync only pulls `status=active&published=true`.
- `products/update` whose product is no longer active/published → **delete its offers
  from GMC** (and mark feed items DELETED) instead of re-pushing.

### Part 4 — Token refresh
- A token provider that, on 401 or near-expiry, calls `POST {oauth}/token`
  (`grant_type=refresh_token`, `clientId`, `clientSecret`) and **persists the new
  access + refresh** (refresh tokens rotate; old one invalidated on success). Used by
  every Ratio API call in the google module.

### Part 5 — Durable SQS sync (replace queueMicrotask)
- New `google-product-sync` queue + `google-product-sync-dlq`, via the existing
  `QueueService` (SQS / ElasticMQ local), mirroring the Meta CAPI pattern.
- Webhook handlers enqueue `{ merchantId, productId, op: 'upsert' | 'delete' }` and
  return 200 fast. A worker drains the queue, fetches the product (REST get by id when
  needed), maps, and pushes to GMC with retry/backoff; exhausted messages → DLQ.
- Gated by env (e.g. `GOOGLE_SYNC_WORKER_ENABLED`) like the CAPI worker.

### Config
- Base URL via existing `RATIO_API_BASE_URL`; the exact products path (`/api/v1/products`
  vs the observed `/api/v1/v1/products`) and oauth path live as named constants the
  operator confirms before go-live (tracked as an open item, not a blocker for build).

### Alternatives rejected
- **Google-only envelope shim** instead of fixing core: leaves meta/posthog/moengage
  webhooks broken against the real contract (latent tech debt) and duplicates mapping.
- **Permanent unique dedupe on (id, event_type)**: would skip legitimate repeated
  updates to the same product — rejected in favor of retry-windowed dedupe.
- **Keep queueMicrotask**: not durable at the target scale; SQS chosen (see the CAPI
  scale design).

## Acceptance criteria
- [ ] Core: a real `{ event_type, merchant_id, product }` delivery validates, routes to
      the matching handler, and is deduped by `(merchantId, productId, event_type)`.
- [ ] Core: a duplicate retry within the window is skipped; a legitimate second update
      to the same product **outside** the window is processed (test both).
- [ ] All modules' webhook handlers compile + their existing webhook tests pass against
      the new envelope.
- [ ] `parseWebhookProduct` maps the sample `products/create` payload: correct variant
      ids (`variant_id`), skus (`sku_id`), options (`option1/2/3` → names), inventory
      (Σ `warehouseQt`), images (`images[].url`), prices in rupees (no ÷100).
- [ ] `parseRestProduct` maps the sample list item: `name`→title, `inventory.quantity`,
      `images[].src`, prices in rupees.
- [ ] `RatioProductsService` pages the `{ success, data, pagination }` envelope and
      requests `status=active&published=true&show_variants=true`.
- [ ] `products/update` → non-active/unpublished removes the product's offers from GMC.
- [ ] Token refresh: an expired access token triggers a refresh + persists the rotated
      access/refresh; the original call then succeeds.
- [ ] Webhook-triggered sync goes through `google-product-sync` (SQS), acks the 200
      before the GMC push; exhausted pushes land in the DLQ.
- [ ] `learnings.md` + `google/CONTEXT.md` updated: prices are rupees (major units), and
      R1 envelope resolved to `{ event_type, merchant_id, product }`.
- [ ] Price unit re-confirmed against a live `GET /products` response before merge.
- [ ] `pnpm verify` is green.

## Out of scope
- The broader CAPI scale-hardening spec (separate change); this only reuses its SQS
  pattern for GMC pushes.
- GMC field-mapping beyond what the mapper already covers (e.g. new GMC attributes).
- Admin UI changes (force-sync button already exists).
- Confirming/most exact base URL + path values (operator provides at go-live).

## Context consulted
- ADR-0001 — multi-handler webhook dispatch (core change builds on it).
- `google/CONTEXT.md` — GMC is server-side Content API sync; R1 (verify webhook
  envelope) — **now resolved** by this change; paise note — **now corrected** to rupees.
- `learnings.md` 2026-06-08 (integer paise) — **overturned** by verified payloads.
- Real contracts: QA docs (webhooks/products/oauth/scopes) + user-provided sample
  `products/create` and `products/delete` deliveries and a `GET /products` response.

## Open items (not blocking the build)
- Exact products path (`/api/v1/products` vs observed doubled `/api/v1/v1/products`)
  and oauth base — operator confirms.
- Whether a delivery-id header exists (e.g. `x-openstore-webhook-id`); if so, prefer it
  over the derived dedupe key.
