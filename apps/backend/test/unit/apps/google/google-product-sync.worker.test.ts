import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueService } from '../../../../src/core/queue/queue.service';
import { FeedSyncService } from '../../../../src/modules/google/gmc/feed-sync.service';
import { GOOGLE_QUEUE_NAMES, type GoogleSyncMessage } from '../../../../src/modules/google/gmc/google-product-sync.queue';
import { GoogleProductSyncWorker } from '../../../../src/modules/google/gmc/google-product-sync.worker';
import type { RatioProduct } from '../../../../src/modules/google/gmc/product-mapper';

const product = { id: 'prod-1', title: 'Widget' } as unknown as RatioProduct;

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

  it('upsert → syncProduct(merchantId, product, "webhook") then ack the handle', async () => {
    const { queue } = fakeQueue([{ op: 'upsert', merchantId: 'm1', product }]);
    const worker = new GoogleProductSyncWorker(queue, feedSync);

    await worker.drainOnce();

    expect(feedSync.syncProduct).toHaveBeenCalledWith('m1', product, 'webhook');
    expect(queue.ack).toHaveBeenCalledWith(GOOGLE_QUEUE_NAMES.sync, ['rh-0']);
  });

  it('delete → deleteProduct(merchantId, productId) then ack the handle', async () => {
    const { queue } = fakeQueue([{ op: 'delete', merchantId: 'm1', productId: 'prod-9' }]);
    const worker = new GoogleProductSyncWorker(queue, feedSync);

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
    const { queue } = fakeQueue([{ op: 'upsert', merchantId: 'm1', product }]);
    const worker = new GoogleProductSyncWorker(queue, boom.feedSync);

    await worker.drainOnce();

    expect(boom.feedSync.syncProduct).toHaveBeenCalled();
    expect(queue.ack).not.toHaveBeenCalled();
  });
});
