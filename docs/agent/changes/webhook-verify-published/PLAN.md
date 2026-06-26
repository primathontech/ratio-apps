# Verify product is published/active on webhook before GMC sync — implementation plan

**Goal:** On a product create/update webhook, fetch the authoritative product by id and sync to GMC only when it's active + published; otherwise remove it from GMC (only if it was synced) — recording the decision in the existing feed log.
**Spec:** docs/agent/changes/webhook-verify-published/SPEC.md
**Execution:** invoke the `execute` skill (it asks subagent-driven vs inline).

> **Notes:** (1) Backend tests live in `apps/backend/test/unit/`; the worker/handler/service all have existing fakes to extend. (2) The by-id `{ product }` shape matches `parseRestProduct` exactly (verified against a live response) — no new parser. (3) `pnpm verify`'s aggregate test step is already red on `main` from unrelated Meta failures (`test/unit/meta/catalog-source-paging.test.ts`) + `admin-meta` lint; this change is green on everything it touches. (4) This stacks on the uncommitted `add-feed-event-log` change in the same working tree. Each task commits and ends green on its targeted test.

---

### Task 1: `getById` on the products port + service (TDD)
**Files:** Modify `apps/backend/src/modules/google/gmc/feed-sync.service.ts` (port), `apps/backend/src/modules/google/gmc/ratio-products.service.ts`; Test `apps/backend/test/unit/apps/google/ratio-products.service.test.ts`
- [ ] Add `getById` to the `RatioProductsPort` interface in `feed-sync.service.ts`:
```ts
export interface RatioProductsPort {
  listAll(merchantId: string): Promise<RatioProduct[]>;
  /** Fetch the authoritative raw product by id, or null if it 404s (gone). */
  getById(merchantId: string, productId: string): Promise<Record<string, unknown> | null>;
}
```
- [ ] Write the failing tests (append to `ratio-products.service.test.ts`):
```ts
import { HttpException } from '@nestjs/common';
// ...
describe('RatioProductsService.getById', () => {
  it('GETs /products/:id?show_variants=true and returns the product object', async () => {
    const request = vi.fn().mockResolvedValue({ product: { id: '7942069485646', title: 'Hair Mask', status: 'active' } });
    const svc = new RatioProductsService(fakeTokens('tok'), { request } as unknown as RatioClient);
    const product = await svc.getById('m1', '7942069485646');
    expect(String(request.mock.calls[0]?.[0])).toContain('/products/7942069485646');
    expect(String(request.mock.calls[0]?.[0])).toContain('show_variants=true');
    expect(product?.id).toBe('7942069485646');
  });
  it('returns null when the upstream 404s (product gone)', async () => {
    const request = vi.fn().mockRejectedValue(
      new HttpException({ message: 'ratio upstream error', details: { status: 404 } }, 502),
    );
    const svc = new RatioProductsService(fakeTokens('tok'), { request } as unknown as RatioClient);
    expect(await svc.getById('m1', 'gone')).toBeNull();
  });
  it('rethrows on a transient upstream error (non-404)', async () => {
    const request = vi.fn().mockRejectedValue(
      new HttpException({ message: 'ratio upstream error', details: { status: 503 } }, 502),
    );
    const svc = new RatioProductsService(fakeTokens('tok'), { request } as unknown as RatioClient);
    await expect(svc.getById('m1', 'p1')).rejects.toBeInstanceOf(HttpException);
  });
});
```
- [ ] Run — expect FAIL: `pnpm --filter @ratio-app/backend exec vitest run test/unit/apps/google/ratio-products.service.test.ts`
- [ ] Implement in `ratio-products.service.ts` (add `HttpException` to the `@nestjs/common` import; the `z`/`Rec` imports already exist):
```ts
// module scope (near envelopeSchema):
const byIdSchema = z.record(z.string(), z.unknown());

/** True when a RatioClient error wraps an upstream 404 (product not found). */
function isUpstreamNotFound(err: unknown): boolean {
  if (!(err instanceof HttpException)) return false;
  const body = err.getResponse();
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { details?: { status?: number } }).details?.status === 404
  );
}

// method on RatioProductsService:
async getById(merchantId: string, productId: string): Promise<Rec | null> {
  const accessToken = await this.tokens.getAccessToken(merchantId);
  try {
    const env = await this.ratio.request(
      `/api/v1/v1/products/${encodeURIComponent(productId)}?show_variants=true`,
      byIdSchema,
      { accessToken },
    );
    const product = (env as Rec).product;
    return product && typeof product === 'object' ? (product as Rec) : null;
  } catch (err) {
    if (isUpstreamNotFound(err)) return null; // gone → caller removes from GMC
    throw err; // transient/5xx/timeout → SQS redrive
  }
}
```
- [ ] Run — expect PASS (same command).
- [ ] Commit.

---

### Task 2: `deleteProduct` is a no-op when nothing was synced (TDD)
**Files:** Modify `apps/backend/src/modules/google/gmc/feed-sync.service.ts`; Test `apps/backend/test/unit/apps/google/feed-sync.service.test.ts`
- [ ] Write the failing test (add to the `deleteProduct` describe):
```ts
it('is a no-op (no GMC call, no logs) when the product was never synced', async () => {
  const fake = makeFakeKysely({ config: configRow(), feedItemRows: [] });
  const { fetch, calls } = fakeFetch(() => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);

  const svc = new FeedSyncService(fake.handle, makeAuth(), makeProducts());
  await svc.deleteProduct(MERCHANT_ID, 'p-never-synced');

  expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  expect(fake.feedItemUpdates).toHaveLength(0);
  expect(fake.syncLogWrites).toHaveLength(0);
  expect(fake.feedEventWrites).toHaveLength(0);
});
```
- [ ] Run — expect FAIL (a `syncLogWrites` row is still written today): `pnpm --filter @ratio-app/backend exec vitest run test/unit/apps/google/feed-sync.service.test.ts`
- [ ] Implement: in `deleteProduct`, right after the `items` select, early-return when empty (before the GMC delete loop, the bulk `updateTable`, the event loop, and `writeSyncLog`):
```ts
const items = await this.handle.db
  .selectFrom('google_feed_items')
  .select(['offerId', 'productId', 'variantId', 'title', 'status'])
  .where('merchantId', '=', merchantId)
  .where('productId', '=', productId)
  .execute();
if (items.length === 0) return; // never synced → nothing to remove, no log noise
```
- [ ] Run — expect PASS (same command); the existing 2-row delete test stays green.
- [ ] Commit.

---

### Task 3: Gate uses authoritative fields — by-id fixture + `isSellable` (TDD)
**Files:** Modify `apps/backend/src/modules/google/gmc/google-product-sync.queue.ts`; Create `apps/backend/test/unit/apps/google/parse-by-id.test.ts`
- [ ] Write the failing tests (the inline fixture is a trimmed copy of a real `GET /products/:id` response — no token/PII):
```ts
import { describe, expect, it } from 'vitest';
import { isSellable } from '../../../../src/modules/google/gmc/google-product-sync.queue';
import { parseRestProduct } from '../../../../src/modules/google/gmc/parse-ratio-product';

// Trimmed real by-id `{ product }` response (token/PII stripped).
const byId = {
  id: '7942069485646',
  title: 'Intense Moisture Hair Mask',
  body_html: '<p>desc</p>',
  vendor: 'BBlunt',
  product_type: 'Kits',
  handle: 'intense-moisture-hair-mask',
  status: 'active',
  published_at: '2026-06-12T16:47:51+05:30',
  is_deleted: false,
  options: [],
  variants: [
    { id: '43860696924238', title: 'Default Title', price: 41900, compare_at_price: 83700, option1: 'Default Title', sku: '', barcode: null, inventory_quantity: 0 },
  ],
  images: [{ src: 'https://os-resources.example/178129823947786.png' }],
} as Record<string, unknown>;

describe('by-id product → mapper + gate', () => {
  it('parseRestProduct maps the by-id shape (price paise → rupees, image src)', () => {
    const p = parseRestProduct(byId);
    expect(p?.id).toBe('7942069485646');
    expect(p?.variants[0]?.price).toBe(419); // 41900 paise ÷ 100
    expect(p?.images[0]?.src).toContain('178129823947786.png');
  });
  it('an active + published product is sellable', () => {
    expect(isSellable(byId)).toBe(true);
  });
  it('draft / unpublished / deleted are NOT sellable', () => {
    expect(isSellable({ ...byId, status: 'draft' })).toBe(false);
    expect(isSellable({ ...byId, published_at: null })).toBe(false);
    expect(isSellable({ ...byId, is_deleted: true })).toBe(false); // fails until the guard is added
  });
});
```
- [ ] Run — expect FAIL on the `is_deleted` case: `pnpm --filter @ratio-app/backend exec vitest run test/unit/apps/google/parse-by-id.test.ts`
- [ ] Implement: add an `is_deleted` guard at the top of `isSellable` in `google-product-sync.queue.ts`:
```ts
export function isSellable(product: Record<string, unknown>): boolean {
  if (product.is_deleted === true) return false;
  if (product.status !== 'active') return false;
  if ('published' in product && !product.published) return false;
  if ('published_at' in product && !product.published_at) return false;
  return true;
}
```
- [ ] Run — expect PASS (same command).
- [ ] Commit.

---

### Task 4: Move the gate to the worker — thin handlers, fetch-by-id + decide (TDD)
**Files:** Modify `apps/backend/src/modules/google/gmc/google-product-sync.queue.ts` (message type), `apps/backend/src/modules/google/webhooks/product-created.handler.ts`, `apps/backend/src/modules/google/webhooks/product-updated.handler.ts`, `apps/backend/src/modules/google/gmc/google-product-sync.worker.ts`; Tests `product-created.handler.test.ts`, `product-updated.handler.test.ts`, `google-product-sync.worker.test.ts`

**4a — Message type** (`google-product-sync.queue.ts`): carry `productId`, keep an optional legacy `product` for rollover safety:
```ts
export type GoogleSyncMessage =
  | { op: 'upsert'; merchantId: string; productId: string; product?: RatioProduct }
  | { op: 'delete'; merchantId: string; productId: string };
```

**4b — Handler tests** (rewrite to the new behavior; both handlers now always enqueue an upsert with `productId` and no longer gate on payload sellability):
- `product-created.handler.test.ts`: replace the "enqueues an upsert for a sellable product (AC)" assertion body and DELETE the "does NOT enqueue a non-sellable (draft) product" test:
```ts
it('enqueues an upsert carrying the productId', async () => {
  await handler.handle(product(), 'm1', trx);
  const [name, payloads] = (q.queue.sendBatch as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(name).toBe(GOOGLE_QUEUE_NAMES.sync);
  expect(payloads).toEqual([{ op: 'upsert', merchantId: 'm1', productId: 'prod-1' }]);
});
it('still enqueues a draft (the worker decides via authoritative fetch)', async () => {
  await handler.handle(product({ status: 'draft' }), 'm1', trx);
  expect(q.queue.sendBatch).toHaveBeenCalledTimes(1);
});
```
- `product-updated.handler.test.ts`: replace the two delete-branch tests ("...no longer sellable", "...unpublished") with a single always-upsert test:
```ts
it('enqueues an upsert carrying the productId (gate moved to the worker)', async () => {
  await handler.handle(product({ status: 'archived' }), 'm1', trx);
  const [, payloads] = (q.queue.sendBatch as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(payloads).toEqual([{ op: 'upsert', merchantId: 'm1', productId: 'prod-1' }]);
});
```
  (Keep the topic, unparseable-payload, and null-merchant tests in both files.)

**4c — Worker tests** (`google-product-sync.worker.test.ts`): add a fake products port + 3rd constructor arg, and cover the gate. Update `fakeFeedSync`/constructor sites:
```ts
import type { RatioProductsPort } from '../../../../src/modules/google/gmc/feed-sync.service';

function fakeProducts(getById: unknown = vi.fn(async () => null)): RatioProductsPort {
  return { listAll: vi.fn(async () => []), getById } as unknown as RatioProductsPort;
}
const sellableRaw = { id: 'prod-1', title: 'Widget', status: 'active', published_at: '2026-01-01T00:00:00Z', variants: [{ id: 'v1', price: 1000 }], images: [{ src: 'https://x/y.jpg' }] };

it('upsert → fetches by id; active+published → syncProduct', async () => {
  const products = fakeProducts(vi.fn(async () => sellableRaw));
  const { queue } = fakeQueue([{ op: 'upsert', merchantId: 'm1', productId: 'prod-1' }]);
  const worker = new GoogleProductSyncWorker(queue, feedSync, products);
  await worker.drainOnce();
  expect(feedSync.syncProduct).toHaveBeenCalledWith('m1', expect.objectContaining({ id: 'prod-1' }), 'webhook');
  expect(feedSync.deleteProduct).not.toHaveBeenCalled();
});
it('upsert → draft product → deleteProduct (remove-if-synced), not synced', async () => {
  const products = fakeProducts(vi.fn(async () => ({ ...sellableRaw, status: 'draft' })));
  const { queue } = fakeQueue([{ op: 'upsert', merchantId: 'm1', productId: 'prod-1' }]);
  const worker = new GoogleProductSyncWorker(queue, feedSync, products);
  await worker.drainOnce();
  expect(feedSync.deleteProduct).toHaveBeenCalledWith('m1', 'prod-1');
  expect(feedSync.syncProduct).not.toHaveBeenCalled();
});
it('upsert → product gone (getById null) → deleteProduct', async () => {
  const products = fakeProducts(vi.fn(async () => null));
  const { queue } = fakeQueue([{ op: 'upsert', merchantId: 'm1', productId: 'prod-1' }]);
  const worker = new GoogleProductSyncWorker(queue, feedSync, products);
  await worker.drainOnce();
  expect(feedSync.deleteProduct).toHaveBeenCalledWith('m1', 'prod-1');
});
it('legacy upsert message carrying product → syncProduct (no fetch)', async () => {
  const getById = vi.fn(async () => null);
  const products = fakeProducts(getById);
  const { queue } = fakeQueue([{ op: 'upsert', merchantId: 'm1', productId: 'prod-1', product } as GoogleSyncMessage]);
  const worker = new GoogleProductSyncWorker(queue, feedSync, products);
  await worker.drainOnce();
  expect(getById).not.toHaveBeenCalled();
  expect(feedSync.syncProduct).toHaveBeenCalledWith('m1', product, 'webhook');
});
```
  Update the existing "upsert → syncProduct…" and "delete → deleteProduct…" and throw tests to pass `fakeProducts()` as the 3rd arg; the existing upsert test's message must include `productId` (use the legacy form `{ op:'upsert', merchantId:'m1', productId:'prod-1', product }`).
- [ ] Run — expect FAIL: `pnpm --filter @ratio-app/backend exec vitest run test/unit/apps/google/google-product-sync.worker.test.ts test/unit/apps/google/product-created.handler.test.ts test/unit/apps/google/product-updated.handler.test.ts`

**4d — Implement handlers.** `product-created.handler.ts` and `product-updated.handler.ts` — drop the `isSellable` import + gate; enqueue by id:
```ts
async handle(data: Record<string, unknown>, merchantId: string | null, _trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>): Promise<void> {
  if (!merchantId) return;
  const product = parseWebhookProduct(data);
  if (!product) {
    this.logger.warn({ msg: 'products/<create|update> with unparseable payload — skipped', merchantId });
    return;
  }
  const msg: GoogleSyncMessage = { op: 'upsert', merchantId, productId: product.id };
  await this.queue.sendBatch(GOOGLE_QUEUE_NAMES.sync, [msg]);
}
```
  (Use the matching log string per handler. `parseWebhookProduct` import stays — it validates + yields the id.)

**4e — Implement the worker.** `google-product-sync.worker.ts`: add the products dependency + gate in `process`:
```ts
import { Inject, Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { type RatioProductsPort, FeedSyncService } from './feed-sync.service';
import { GOOGLE_QUEUE_NAMES, type GoogleSyncMessage, isSellable } from './google-product-sync.queue';
import { parseRestProduct } from './parse-ratio-product';
import { GOOGLE_RATIO_PRODUCTS } from '../tokens';
// ...
constructor(
  private readonly queue: QueueService,
  private readonly feedSync: FeedSyncService,
  @Inject(GOOGLE_RATIO_PRODUCTS) private readonly products: RatioProductsPort,
) {}

private async process(msg: GoogleSyncMessage): Promise<void> {
  if (msg.op !== 'upsert') {
    await this.feedSync.deleteProduct(msg.merchantId, msg.productId);
    return;
  }
  // Rollover: a message enqueued before this change carries the parsed product.
  if (msg.product) {
    await this.feedSync.syncProduct(msg.merchantId, msg.product, 'webhook');
    return;
  }
  // Authoritative read-after-event: only sync active + published products.
  const raw = await this.products.getById(msg.merchantId, msg.productId);
  if (raw && isSellable(raw)) {
    const product = parseRestProduct(raw);
    if (product) {
      await this.feedSync.syncProduct(msg.merchantId, product, 'webhook');
      return;
    }
    this.logger.warn({ msg: 'authoritative product unparseable — leaving GMC as-is', merchantId: msg.merchantId, productId: msg.productId });
    return;
  }
  // Gone, draft, or unpublished → remove from GMC (no-op if never synced).
  await this.feedSync.deleteProduct(msg.merchantId, msg.productId);
}
```
  (No `google.module.ts` change: the worker is already a provider and `GOOGLE_RATIO_PRODUCTS` is already provided via `useExisting: RatioProductsService`.)
- [ ] Run — expect PASS (same command as 4c).
- [ ] Run the full Google backend suite + admin: `pnpm --filter @ratio-app/backend exec vitest run test/unit/apps/google && pnpm --filter @ratio-app/backend typecheck`
- [ ] Commit.

---

### Definition of done
- [ ] All 4 tasks committed.
- [ ] Google backend tests green; `typecheck` + `build` green for backend.
- [ ] Record the change via the `remember` skill (google `CONTEXT.md` journal) and clear `PROGRESS.md`.
- [ ] `GOOGLE_SYNC_WORKER_ENABLED=true` is required for the worker to run (deploy/env — unchanged).
