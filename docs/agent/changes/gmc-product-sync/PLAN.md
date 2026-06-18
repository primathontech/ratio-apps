# GMC product sync hardening + core webhook envelope fix — implementation plan
**Goal:** Make GMC product sync correct, durable, and aligned to the real OpenStore contracts, and fix the core webhook envelope once for all modules.
**Spec:** docs/agent/changes/gmc-product-sync/SPEC.md
**Execution:** invoke the `execute` skill (it asks subagent-driven vs inline).

## File map
- `apps/backend/src/core/webhooks/webhooks.types.ts` — envelope schema → real shape; derive dedupe id.
- `apps/backend/src/core/webhooks/webhooks.service.ts` — route on `event_type`; retry-windowed dedupe.
- `apps/backend/src/modules/{google,meta,posthog,moengage}/webhooks/webhooks.controller.ts` — no change to handler signatures (handlers already take `data`), verify envelope wiring.
- `apps/backend/src/core/queue/queue.service.ts` — **new**: QueueService lifted from `modules/meta/queue` (generic queue-name string).
- `apps/backend/src/modules/meta/queue/queue.service.ts` — re-export core QueueService; keep meta `QUEUE_NAMES`.
- `apps/backend/src/modules/google/gmc/parse-ratio-product.ts` — split into `parseWebhookProduct` + `parseRestProduct`; remove ÷100.
- `apps/backend/src/modules/google/gmc/ratio-products.service.ts` — `{success,data,pagination}` envelope; active+published query; use `parseRestProduct`.
- `apps/backend/src/modules/google/webhooks/product-updated.handler.ts` — delete-from-GMC on non-active/unpublished.
- `apps/backend/src/modules/google/google-oauth/ratio-oauth.http.ts` + `ratio-token.provider.ts` — **new**: Ratio token refresh + rotation/persist.
- `apps/backend/src/modules/google/gmc/google-product-sync.queue.ts` + `google-product-sync.worker.ts` — **new**: durable SQS sync.
- `apps/backend/src/modules/google/google.module.ts` — wire new providers + worker.
- `apps/backend/src/config/env.schema.ts` + `.env.example` — `GOOGLE_SYNC_WORKER_ENABLED`, queue names.
- `docs/agent/context/learnings.md`, `docs/agent/apps/google/CONTEXT.md` — correct paise→rupees; resolve R1.

Commands: iterate with `pnpm --filter @ratio-app/backend test`; each task ends green at `pnpm verify`. Commit per task.

---

### Task 1: Core envelope schema → real `{event_type, merchant_id, product}`
**Files:** Modify `apps/backend/src/core/webhooks/webhooks.types.ts`; Test `apps/backend/test/unit/core/webhooks.service.test.ts`
- [ ] Write failing test: a delivery `{ event_type: 'products/create', merchant_id: 'm1', product: { id: 'p1', title: 'X' } }` parses via `webhookEnvelopeSchema`, yielding `eventType='products/create'`, `merchantId='m1'`, `product.id='p1'`.
- [ ] Run — expect FAIL: `pnpm --filter @ratio-app/backend test webhooks.service`
- [ ] Implement:
```ts
export const webhookEnvelopeSchema = z.object({
  event_type: z.string().min(1).max(128),
  merchant_id: z.string().min(1).nullable().optional(),
  product: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;
// Derived idempotency id used for webhook_log dedupe (no delivery id in the contract).
export function deriveWebhookId(e: WebhookEnvelope): string {
  const rid = (e.product && typeof e.product.id === 'string' && e.product.id) || 'none';
  return `${e.event_type}:${rid}`;
}
```
  Keep `WEBHOOK_MAX_PAYLOAD_BYTES`; drop `WEBHOOK_MAX_SKEW_MS` usage (no timestamp).
- [ ] Run — expect PASS, then `pnpm verify`.

### Task 2: Dispatch routes on `event_type`, retry-windowed dedupe
**Files:** Modify `apps/backend/src/core/webhooks/webhooks.service.ts`; Test same spec file
- [ ] Write failing tests: (a) handler whose `topic==='products/create'` runs for the new envelope; (b) a duplicate within `WEBHOOK_DEDUPE_WINDOW_MS` is skipped (handler called once); (c) a same-key delivery whose existing row is older than the window **re-runs** the handler.
- [ ] Run — expect FAIL.
- [ ] Implement: replace `envelope.event`→`envelope.event_type`, `envelope.merchantId`→`envelope.merchant_id`, `envelope.data`→`envelope.product ?? {}`, `envelope.id`→`deriveWebhookId(envelope)`. On `INSERT IGNORE` collision (`!isNew`), `SELECT receivedAt` for the existing `ratioWebhookId`; if `now - receivedAt > WEBHOOK_DEDUPE_WINDOW_MS` (default 3h), update the row's `receivedAt`+re-run the handler (idempotent); else return. Remove the skew check.
- [ ] Run — expect PASS, then `pnpm verify`.

### Task 3: Verify all-module webhook controllers + handlers compile against new envelope
**Files:** Inspect/Modify each `modules/*/webhooks/webhooks.controller.ts`, `*-uninstalled.handler.ts`; Tests: existing per-module webhook tests
- [ ] Run the full suite — expect FAILs surfacing any module that referenced the old fields: `pnpm --filter @ratio-app/backend test`
- [ ] Fix each break minimally (handlers already receive `data` → now the `product` object; `app/uninstalled` has no `product`, so its handler reads `merchantId` only — unaffected). Confirm `deriveWebhookId` for `app/uninstalled` yields `app/uninstalled:none` (uninstall is idempotent).
- [ ] Run — expect PASS, then `pnpm verify`.

### Task 4: `parseWebhookProduct` (webhook product shape)
**Files:** Modify `apps/backend/src/modules/google/gmc/parse-ratio-product.ts`; Test `apps/backend/test/unit/apps/google/parse-webhook-product.test.ts` (new)
- [ ] Write failing test using the real `products/create` sample: asserts `title='Premium Wireless Headphones'`, one variant with `id='var-001'` (from `variant_id`), `sku='VAR-HDP-BLK-001'` (from `sku_id`), `options={Color:'Black'}` (from `option1` + product `options[0].name`), `inventoryQuantity=75` (Σ `warehouseQt`), `price=199.99` (**rupees, no ÷100**), `images=[{src:'https://cdn.example.com/products/headphones-main.jpg'}]` (from `images[].url`).
- [ ] Run — expect FAIL.
- [ ] Implement `parseWebhookProduct(product)`: map `title/body_html/handle/product_type/vendor`; variants from `variant_id`/`sku_id`/`barcode`/`price`(passthrough)/`compare_at_price`; options by joining `option1/2/3` to product `options[i].name`; inventory = sum of `warehouseQt[].quantity`; images from `images[].url` with `imageUrl` fallback. **No `paiseToMajor`.**
- [ ] Run — expect PASS, then `pnpm verify`.

### Task 5: `parseRestProduct` (REST product shape) — replace ÷100
**Files:** Modify `apps/backend/src/modules/google/gmc/parse-ratio-product.ts`; Test `apps/backend/test/unit/apps/google/parse-rest-product.test.ts` (new)
- [ ] Write failing test using the real list/single sample: `title` from `name`, `description`, `productType`, variant `id`, `sku`, `price=29.99` (rupees), `compareAtPrice=39.99`, `inventoryQuantity=50` (from `inventory.quantity`), `options={size,color}`, `images[].src`.
- [ ] Run — expect FAIL.
- [ ] Implement `parseRestProduct(item)` accordingly; delete the old `parseRatioProduct` and the `paiseToMajor` helper. Update the create/update webhook handlers to call `parseWebhookProduct`.
- [ ] Run — expect PASS, then `pnpm verify`.

### Task 6: `RatioProductsService` — real list envelope + active/published query
**Files:** Modify `apps/backend/src/modules/google/gmc/ratio-products.service.ts`; Test `apps/backend/test/unit/apps/google/ratio-products.service.test.ts` (new, fake RatioClient)
- [ ] Write failing test: given a fake client returning `{success,data:[item],pagination:{page:1,totalPages:2}}` then page 2, `listAll` returns both products mapped via `parseRestProduct`, and requested paths include `status=active&published=true&show_variants=true`.
- [ ] Run — expect FAIL.
- [ ] Implement: `listSchema = z.object({ success: z.boolean(), data: z.array(productSchema), pagination: z.object({ page:z.number(), totalPages:z.number() }) })`; loop `page` until `page >= pagination.totalPages`; query string `?limit=100&page=${page}&status=active&published=true&show_variants=true`; map each via `parseRestProduct`.
- [ ] Run — expect PASS, then `pnpm verify`.

### Task 7: `products/update` → delete-from-GMC on non-active/unpublished
**Files:** Modify `apps/backend/src/modules/google/webhooks/product-updated.handler.ts`; Test `apps/backend/test/unit/apps/google/product-updated.handler.test.ts` (new)
- [ ] Write failing test: update payload with `status!=='active'` (or unpublished) → handler enqueues a **delete** op, not an upsert; active+published → enqueues upsert.
- [ ] Run — expect FAIL.
- [ ] Implement: read `product.status` / published flag; if not sellable, `enqueue delete`; else `enqueue upsert`.
- [ ] Run — expect PASS, then `pnpm verify`.

### Task 8: Ratio token refresh (`RatioOAuthHttp` + `RatioTokenProvider`)
**Files:** Create `apps/backend/src/modules/google/google-oauth/ratio-oauth.http.ts`, `ratio-token.provider.ts`; Test `apps/backend/test/unit/apps/google/ratio-token.provider.test.ts` (new)
- [ ] Write failing test: provider with an expired stored token calls `RatioOAuthHttp.refresh` (fake `fetchImpl`), persists the **rotated** access+refresh (encrypted), and returns the new access token; a still-valid token is returned without a network call.
- [ ] Run — expect FAIL.
- [ ] Implement `RatioOAuthHttp.refresh(refreshToken, creds)` → `POST {RATIO_API_BASE_URL}/api/v1/oauth/token` body `{grant_type:'refresh_token', refresh_token, clientId, clientSecret}` returning `{access_token, refresh_token, expires_in}`. `RatioTokenProvider.getAccessToken(merchantId)`: read `oauth_tokens`, refresh if `expiresAt <= now+60s`, persist rotated tokens + `expiresAt = now + expires_in*1000`. Mirror `GoogleOAuthHttp` (`fetchImpl` injection).
- [ ] Run — expect PASS, then `pnpm verify`.

### Task 9: Wire `RatioTokenProvider` into `RatioProductsService`
**Files:** Modify `apps/backend/src/modules/google/gmc/ratio-products.service.ts`, `google.module.ts`; Test extends Task 6 test
- [ ] Write failing test: `listAll` obtains its bearer token from `RatioTokenProvider.getAccessToken` (not the raw stored token).
- [ ] Run — expect FAIL.
- [ ] Implement: inject `RatioTokenProvider`; replace the direct `oauth_tokens` read; register the provider in `google.module.ts`.
- [ ] Run — expect PASS, then `pnpm verify`.

### Task 10: Lift `QueueService` into `core/queue`
**Files:** Create `apps/backend/src/core/queue/queue.service.ts`; Modify `apps/backend/src/modules/meta/queue/queue.service.ts` (re-export + keep `QUEUE_NAMES`); Test `apps/backend/test/unit/core/queue.service.test.ts` (move/adapt any existing meta queue test)
- [ ] Write failing test: core `QueueService.sendBatch/receive/ack` work with a fake SQS client and an arbitrary string queue name.
- [ ] Run — expect FAIL.
- [ ] Implement: move the class to `core/queue` with `QueueName = string`; meta file becomes `export { QueueService } from '../../../core/queue/queue.service'` plus its own `QUEUE_NAMES`. No behavior change.
- [ ] Run — expect PASS (meta CAPI tests still green), then `pnpm verify`.

### Task 11: Google sync queue + enqueue from webhook handlers (replace `queueMicrotask`)
**Files:** Create `apps/backend/src/modules/google/gmc/google-product-sync.queue.ts`; Modify the 3 google webhook handlers + `FeedSyncService`; Test handler tests assert enqueue
- [ ] Write failing test: create/update/delete handlers call `QueueService.sendBatch('google-product-sync', [{merchantId, productId, op}])` (not `enqueuePush`/`queueMicrotask`).
- [ ] Run — expect FAIL.
- [ ] Implement: `GOOGLE_QUEUE_NAMES = { sync: 'google-product-sync', dlq: 'google-product-sync-dlq' }`; handlers enqueue `{merchantId, productId, op}`; remove `enqueuePush`/`enqueueDelete` microtask methods from `FeedSyncService` (keep `syncProduct`/`deleteProduct`/`fullSync`).
- [ ] Run — expect PASS, then `pnpm verify`.

### Task 12: `GoogleProductSyncWorker` (drain → fetch → map → push → DLQ)
**Files:** Create `apps/backend/src/modules/google/gmc/google-product-sync.worker.ts`; Modify `google.module.ts`, `env.schema.ts`, `.env.example`; Test `apps/backend/test/unit/apps/google/google-product-sync.worker.test.ts` (new)
- [ ] Write failing test: worker reads a `{merchantId, productId, op:'upsert'}` message, fetches the product (REST get-by-id via a faked source), calls `FeedSyncService.syncProduct`, and acks on success; a failing push leaves the message un-acked (redrive → DLQ).
- [ ] Run — expect FAIL.
- [ ] Implement: poll loop mirroring `MetaCapiWorker` (gated by `GOOGLE_SYNC_WORKER_ENABLED==='true'`, visibility > processing time); `upsert` → fetch by id + `syncProduct`; `delete` → `deleteProduct`; ack only on success. Add `GET /api/v1/products/:id?show_variants=true` to `RatioProductsService` (`getById`, via `parseRestProduct`). Add env var + queue names to `.env.example`.
- [ ] Run — expect PASS, then `pnpm verify`.

### Task 13: Correct context docs (paise→rupees, R1 resolved)
**Files:** Modify `docs/agent/context/learnings.md`, `docs/agent/apps/google/CONTEXT.md`
- [ ] Update the 2026-06-08 learning: Ratio product/variant prices are **rupees (major units)** in the QA contract — do **not** divide by 100 (supersedes the prior paise note). Add today's dated learning noting the reversal + that it was verified against real payloads.
- [ ] Update `google/CONTEXT.md`: remove the paise line; mark R1 resolved → envelope is `{event_type, merchant_id, product}`, dedupe by `(merchantId, productId, event_type)`.
- [ ] `pnpm verify` (docs-only, but keep the suite green); commit.

## Self-review
Every SPEC acceptance criterion maps to a task: envelope/route/dedupe → T1–T3; webhook parser → T4; rest parser → T5; list envelope/query → T6; update→delete → T7; token refresh → T8–T9; durable SQS + ack-before-push + DLQ → T10–T12; docs/learning correction → T13; live price re-confirm → SPEC open item (pre-merge). Names/types (`parseWebhookProduct`, `parseRestProduct`, `RatioTokenProvider`, `GOOGLE_QUEUE_NAMES`, `deriveWebhookId`) are consistent across tasks. No placeholders.
