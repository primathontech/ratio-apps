import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueService } from '../../../../src/core/queue/queue.service';
import { FeedSyncService, type RatioProductsPort } from '../../../../src/modules/google/gmc/feed-sync.service';
import { GOOGLE_QUEUE_NAMES, type GoogleSyncMessage } from '../../../../src/modules/google/gmc/google-product-sync.queue';
import { GoogleProductSyncWorker } from '../../../../src/modules/google/gmc/google-product-sync.worker';
import type { RatioProduct } from '../../../../src/modules/google/gmc/product-mapper';

const product = { id: 'prod-1', title: 'Widget' } as unknown as RatioProduct;

/** A raw by-id product that is active + published → sellable + parseable. */
const sellableRaw = {
  id: 'prod-1',
  title: 'Widget',
  status: 'active',
  published_at: '2026-01-01T00:00:00Z',
  variants: [{ id: 'v1', price: 1000 }],
  images: [{ src: 'https://x/y.jpg' }],
};

/** Fake products port; getById is overridable per test. */
function fakeProducts(getById: unknown = vi.fn(async () => null)): RatioProductsPort {
  return { listAll: vi.fn(async () => []), getById } as unknown as RatioProductsPort;
}

/** Queue whose `receive` yields one batch then drains, so a single drain is deterministic. */
function fakeQueue(messages: GoogleSyncMessage[]) {
  const received = messages.map((body, i) => ({ body, receiptHandle: `rh-${i}` }));
  const queue = {
    receive: vi.fn(async () => received),
    ack: vi.fn(async () => undefined),
  } as unknown as QueueService;
  return { queue };
}

function fakeFeedSync(overrides: Partial<Record<'syncProduct' | 'deleteProduct', unknown>> = {}) {
  const feedSync = {
    syncProduct: vi.fn(async () => ({ updated: 1, errored: 0 })),
    deleteProduct: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as FeedSyncService;
  return { feedSync };
}

describe('GoogleProductSyncWorker', () => {
  let feedSync: FeedSyncService;

  beforeEach(() => {
    feedSync = fakeFeedSync().feedSync;
  });

  it('upsert → fetches by id; active+published → syncProduct then ack', async () => {
    const products = fakeProducts(vi.fn(async () => sellableRaw));
    const { queue } = fakeQueue([{ op: 'upsert', merchantId: 'm1', productId: 'prod-1' }]);
    const worker = new GoogleProductSyncWorker(queue, feedSync, products);

    await worker.drainOnce();

    expect(feedSync.syncProduct).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ id: 'prod-1' }),
      'webhook',
    );
    expect(feedSync.deleteProduct).not.toHaveBeenCalled();
    expect(queue.ack).toHaveBeenCalledWith(GOOGLE_QUEUE_NAMES.sync, ['rh-0']);
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
    expect(feedSync.syncProduct).not.toHaveBeenCalled();
  });

  it('legacy upsert message carrying product → syncProduct (no fetch)', async () => {
    const getById = vi.fn(async () => null);
    const products = fakeProducts(getById);
    const { queue } = fakeQueue([
      { op: 'upsert', merchantId: 'm1', productId: 'prod-1', product } as GoogleSyncMessage,
    ]);
    const worker = new GoogleProductSyncWorker(queue, feedSync, products);

    await worker.drainOnce();

    expect(getById).not.toHaveBeenCalled();
    expect(feedSync.syncProduct).toHaveBeenCalledWith('m1', product, 'webhook');
  });

  it('delete → deleteProduct(merchantId, productId) then ack the handle', async () => {
    const { queue } = fakeQueue([{ op: 'delete', merchantId: 'm1', productId: 'prod-9' }]);
    const worker = new GoogleProductSyncWorker(queue, feedSync, fakeProducts());

    await worker.drainOnce();

    expect(feedSync.deleteProduct).toHaveBeenCalledWith('m1', 'prod-9');
    expect(queue.ack).toHaveBeenCalledWith(GOOGLE_QUEUE_NAMES.sync, ['rh-0']);
  });

  it('does NOT ack when processing throws (left for redrive → DLQ)', async () => {
    const boom = fakeFeedSync({
      syncProduct: vi.fn(async () => {
        throw new Error('GMC down');
      }),
    });
    const { queue } = fakeQueue([{ op: 'upsert', merchantId: 'm1', productId: 'prod-1', product }]);
    const worker = new GoogleProductSyncWorker(queue, boom.feedSync, fakeProducts());

    await worker.drainOnce();

    expect(boom.feedSync.syncProduct).toHaveBeenCalled();
    expect(queue.ack).not.toHaveBeenCalled();
  });
});
