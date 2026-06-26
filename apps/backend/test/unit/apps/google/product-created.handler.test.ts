import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../../src/core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../../src/core/webhooks/webhook-log.types';
import type { QueueService } from '../../../../src/core/queue/queue.service';
import { GoogleProductCreatedHandler } from '../../../../src/modules/google/webhooks/product-created.handler';
import { GOOGLE_QUEUE_NAMES } from '../../../../src/modules/google/gmc/google-product-sync.queue';
import { GOOGLE_WEBHOOK_TOPICS } from '../../../../src/modules/google/webhooks/topics';

type Trx = Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>;
const trx = {} as Trx;

function fakeQueue() {
  const calls: { name: string; payloads: unknown[] }[] = [];
  const queue = {
    sendBatch: vi.fn(async (name: string, payloads: unknown[]) => {
      calls.push({ name, payloads });
    }),
  } as unknown as QueueService;
  return { queue, calls };
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

describe('GoogleProductCreatedHandler', () => {
  let handler: GoogleProductCreatedHandler;
  let q: ReturnType<typeof fakeQueue>;
  beforeEach(() => {
    q = fakeQueue();
    handler = new GoogleProductCreatedHandler(q.queue);
  });

  it('subscribes to the products/create topic', () => {
    expect(handler.topic).toBe(GOOGLE_WEBHOOK_TOPICS.productsCreate);
  });

  it('enqueues an upsert for a sellable product (AC)', async () => {
    await handler.handle(product(), 'm1', trx);
    expect(q.queue.sendBatch).toHaveBeenCalledTimes(1);
    const [name, payloads] = (q.queue.sendBatch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(name).toBe(GOOGLE_QUEUE_NAMES.sync);
    expect(payloads).toEqual([{ op: 'upsert', merchantId: 'm1', productId: 'prod-1' }]);
  });

  it('still enqueues a draft (the worker decides via the authoritative fetch)', async () => {
    await handler.handle(product({ status: 'draft' }), 'm1', trx);
    expect(q.queue.sendBatch).toHaveBeenCalledTimes(1);
  });

  it('skips an unparseable payload', async () => {
    await handler.handle({ status: 'active' }, 'm1', trx);
    expect(q.queue.sendBatch).not.toHaveBeenCalled();
  });

  it('is a no-op when merchantId is null', async () => {
    await handler.handle(product(), null, trx);
    expect(q.queue.sendBatch).not.toHaveBeenCalled();
  });
});
