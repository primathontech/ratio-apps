import { describe, expect, it } from 'vitest';
import type { ClevertapCatalogDirtyScheduler } from '../../../../src/modules/clevertap/sync/catalog-dirty.scheduler';
import { ClevertapProductCreatedHandler } from '../../../../src/modules/clevertap/webhooks/product-created.handler';
import { CLEVERTAP_WEBHOOK_TOPICS } from '../../../../src/modules/clevertap/webhooks/topics';
import { CLEVERTAP_TEST_MERCHANT_ID } from './helpers/fixtures/envelopes';

function harness() {
  const marked: string[] = [];
  const scheduler = {
    markDirty: (merchantId: string) => {
      marked.push(merchantId);
    },
  } as unknown as ClevertapCatalogDirtyScheduler;
  return { marked, handler: new ClevertapProductCreatedHandler(scheduler) };
}

const PRODUCT = { id: '10155084972338', title: 'Cotton T-Shirt', price: 155900 };
const TRX = {} as never;

describe('ClevertapProductCreatedHandler', () => {
  it('subscribes to the products/create topic', () => {
    expect(harness().handler.topic).toBe(CLEVERTAP_WEBHOOK_TOPICS.productsCreate);
    expect(harness().handler.topic).toBe('products/create');
  });

  it('marks the merchant catalog dirty and does not forward per-item', async () => {
    const { handler, marked } = harness();
    await handler.handle(PRODUCT, CLEVERTAP_TEST_MERCHANT_ID, TRX);
    expect(marked).toEqual([CLEVERTAP_TEST_MERCHANT_ID]);
  });

  it('no-ops for an unknown merchant (nothing marked dirty)', async () => {
    const { handler, marked } = harness();
    await handler.handle(PRODUCT, null, TRX);
    expect(marked).toHaveLength(0);
  });
});
