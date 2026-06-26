# Verify product is published/active on webhook before GMC sync — spec

- **Slug:** webhook-verify-published   **Type:** feature   **Size:** feature
- **Area:** apps/google (backend `modules/google/webhooks` + `gmc`)

## Problem / goal

Today the product webhook handlers decide whether to sync to Google Merchant Center by
running `isSellable()` on the **raw webhook payload** (`product-created.handler.ts:40`,
`product-updated.handler.ts:38`). The webhook payload is not a reliable source of
publish state — it may omit `published`/`published_at` or arrive out of order — so we
can push drafts/unpublished products to GMC, or miss an unpublish.

**Goal:** On a product create/update webhook, fetch the **authoritative** product from
the Ratio API by id and sync to GMC only when it is **active AND published**; otherwise
ensure it is not in GMC. Record the decision in the existing feed log
([[add-feed-event-log]] `google_feed_events`).

Confirmed against the live API (`GET /api/v1/v1/products/:id?show_variants=true`,
envelope `{ "product": { … } }`):
- "Published" = `published_at` is non-null (there is **no** boolean `published` on the
  single-product response); "active" = `status === 'active'`. `is_deleted` is also present.
- `isSellable()` already reads `status` + `published_at`, so it works on this record as-is.

## Approach

Move the publish/active decision from the webhook handler (payload-based, unreliable) to
the **worker** (authoritative, fetched-by-id).

1. **Thin the handlers.** `product-created` and `product-updated` enqueue
   `{ op: 'upsert', merchantId, productId }` (extract `productId` via `parseWebhookProduct(data)?.id`;
   skip if unparseable). They no longer call `isSellable` on the payload. `product-deleted`
   still enqueues `{ op: 'delete', merchantId, productId }`.
2. **Change the queue message** `GoogleSyncMessage` upsert variant from carrying the parsed
   `product` to carrying `productId`. The worker tolerates a legacy `{ product }` message for
   one deploy (rollover safety) — if `product` is present, use it; else fetch by id.
3. **Add `RatioProductsPort.getById`** + implement in `RatioProductsService`:
   `GET /api/v1/v1/products/:id?show_variants=true`, return the `product` object (raw `Record`)
   or `null`. Map a 404 (`HttpException` with `details.status === 404`) → `null` (product gone);
   rethrow transient/5xx/timeout so the SQS message redelivers.
4. **Worker `process('upsert')`:** fetch by id, then:
   - **found AND `isSellable(raw)`** → parse to `RatioProduct` and `feedSync.syncProduct(merchantId, product, 'webhook')` (existing flow logs SYNCED/WARNING/ERROR).
   - **`null` (gone) OR not sellable** → `feedSync.deleteProduct(merchantId, productId)`, which **only removes from GMC + logs `DELETED` if the product was actually synced** (a `google_feed_items` row exists); if it was never synced it is a no-op with **no** log row.
5. **`deleteProduct` early-return:** when there are zero `google_feed_items` rows for the
   product, return without calling GMC and without writing a `google_sync_log` row — so a
   never-synced unpublished product produces no log noise (per decision). This also de-noises
   genuine delete webhooks for never-synced products.
6. **Parser audit:** the by-id `{product}` shape is a mix (`title`/`option1`/`inventory_quantity`
   like the webhook shape, but `images[].src` like REST; price in paise, e.g. `41900`). Pick or
   adapt `parseWebhookProduct`/`parseRestProduct` to fit it, proven by a fixture built from a real
   response **with the auth token and any PII stripped**.

**Alternatives rejected:**
- *Gate in the handler on a fresh fetch* — puts a network call + token refresh in Ratio's ~5s
  webhook-ack budget. The worker is the durable, rate-limited place.
- *Trust the webhook payload's published flag* — the unreliability of that flag is the bug.

## Acceptance criteria

- [ ] Create/update handlers enqueue `{ op:'upsert', merchantId, productId }` and no longer gate on `isSellable(payload)`.
- [ ] Worker fetches the product by id and syncs to GMC **only** when `status==='active'` AND `published_at` is set.
- [ ] A published+active product → synced (logged via existing feed flow). An out-of-stock published product is **still synced** (stock not gated).
- [ ] A draft/unpublished product that **was** in GMC → removed from GMC and `google_feed_events` logs the `→ DELETED` transition.
- [ ] A draft/unpublished product that was **never** synced → no GMC call, **no** `google_feed_events` row, **no** `google_sync_log` row.
- [ ] `getById` returns `null` on upstream 404 (→ remove-if-synced) and **throws** on transient/5xx/timeout (→ SQS redrive, no false delete).
- [ ] A real by-id response fixture (token/PII stripped) parses into a `RatioProduct` and maps to a valid GMC offer.
- [ ] Worker handles a legacy `{ op:'upsert', product }` message without crashing (rollover safety).
- [ ] `pnpm verify` is green (modulo the pre-existing unrelated Meta `catalog-source-paging` + admin-meta lint failures already present on `main`).

## Out of scope

- Gating on stock/inventory (out-of-stock published products still sync).
- The full/reconcile sync path (`listAll` is already filtered `status=active&published=true`).
- Meta, and any change to `google_feed_items`/`google_sync_log` schema (reuses [[add-feed-event-log]]).
- Backfilling decisions for products synced before this ships.

## Context consulted

- `docs/agent/apps/google/CONTEXT.md` — durable SQS sync (`google-product-sync` + worker, gated by
  `GOOGLE_SYNC_WORKER_ENABLED`); two product normalizers; prices are integer paise (÷100);
  `products/update` on a non-sellable product already deletes from GMC.
- Ratio docs MCP `get_api_reference(products)` + a live `GET /products/:id` response: by-id endpoint
  exists, envelope `{ product }`, published = `published_at != null`.
- `core/ratio-client/ratio.client.ts` — non-OK → `HttpException(502, details.status)`; 404 is distinguishable.
- [[add-feed-event-log]] — the `google_feed_events` audit log this decision is recorded in.
- **Security:** a live prod merchant bearer token was shared during brainstorming; it must be rotated and must never be committed or placed in a fixture.
