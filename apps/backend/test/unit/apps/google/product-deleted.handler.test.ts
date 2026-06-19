import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../../src/core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../../src/core/webhooks/webhook-log.types';
import type { QueueService } from '../../../../src/core/queue/queue.service';
import { GoogleProductDeletedHandler } from '../../../../src/modules/google/webhooks/product-deleted.handler';
import { GOOGLE_QUEUE_NAMES } from '../../../../src/modules/google/gmc/google-product-sync.queue';
import { GOOGLE_WEBHOOK_TOPICS } from '../../../../src/modules/google/webhooks/topics';

type Trx = Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>;
const trx = {} as Trx;

function fakeQueue() {
  const queue = {
    sendBatch: vi.fn(async () => undefined),
  } as unknown as QueueService;
  return { queue };
}

describe('GoogleProductDeletedHandler', () => {
  let handler: GoogleProductDeletedHandler;
  let q: ReturnType<typeof fakeQueue>;
  beforeEach(() => {
    q = fakeQueue();
    handler = new GoogleProductDeletedHandler(q.queue);
  });

  it('subscribes to the products/delete topic', () => {
    expect(handler.topic).toBe(GOOGLE_WEBHOOK_TOPICS.productsDelete);
  });

  it('enqueues a delete for the product id', async () => {
    await handler.handle({ id: 'prod-1' }, 'm1', trx);
    const [name, payloads] = (q.queue.sendBatch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(name).toBe(GOOGLE_QUEUE_NAMES.sync);
    expect(payloads).toEqual([{ op: 'delete', merchantId: 'm1', productId: 'prod-1' }]);
  });

  it('extracts the id from a nested product object', async () => {
    await handler.handle({ product: { id: 'prod-2' } }, 'm1', trx);
    const [, payloads] = (q.queue.sendBatch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payloads).toEqual([{ op: 'delete', merchantId: 'm1', productId: 'prod-2' }]);
  });

  it('skips when there is no product id', async () => {
    await handler.handle({}, 'm1', trx);
    expect(q.queue.sendBatch).not.toHaveBeenCalled();
  });
});
