import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../../src/core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../../src/core/webhooks/webhook-log.types';
import type { QueueService } from '../../../../src/core/queue/queue.service';
import { GoogleProductUpdatedHandler } from '../../../../src/modules/google/webhooks/product-updated.handler';
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

const product = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'prod-1',
  title: 'Widget',
  handle: 'widget',
  status: 'active',
  price: 9.99,
  images: [{ url: 'https://x/y.jpg' }],
  ...overrides,
});

describe('GoogleProductUpdatedHandler', () => {
  let handler: GoogleProductUpdatedHandler;
  let q: ReturnType<typeof fakeQueue>;
  beforeEach(() => {
    q = fakeQueue();
    handler = new GoogleProductUpdatedHandler(q.queue);
  });

  it('subscribes to the products/update topic', () => {
    expect(handler.topic).toBe(GOOGLE_WEBHOOK_TOPICS.productsUpdate);
  });

  it('enqueues an upsert carrying the productId', async () => {
    await handler.handle(product(), 'm1', trx);
    const [name, payloads] = (q.queue.sendBatch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(name).toBe(GOOGLE_QUEUE_NAMES.sync);
    expect(payloads).toEqual([{ op: 'upsert', merchantId: 'm1', productId: 'prod-1' }]);
  });

  it('still enqueues an upsert for an archived product (the worker removes it from GMC)', async () => {
    await handler.handle(product({ status: 'archived' }), 'm1', trx);
    const [, payloads] = (q.queue.sendBatch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payloads).toEqual([{ op: 'upsert', merchantId: 'm1', productId: 'prod-1' }]);
  });

  it('skips an unparseable payload', async () => {
    await handler.handle({ status: 'active' }, 'm1', trx);
    expect(q.queue.sendBatch).not.toHaveBeenCalled();
  });
});
