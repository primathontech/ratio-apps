import { describe, expect, it } from 'vitest';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../../src/core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../../src/core/webhooks/webhook-log.types';
import {
  UC_WEBHOOK_TOPICS,
  UcProductSyncHandler,
} from '../../../../src/modules/unicommerce/webhooks/product-sync.handler';

type Trx = Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>;

interface Call {
  table: string;
  values: Record<string, unknown>;
  onDuplicateKeyUpdate?: Record<string, unknown>;
}

/**
 * Fake trx recording EVERY `.insertInto(...)` call made during a single
 * `handle()` invocation, not just the last one — the handler now writes both
 * `ucSkuCache` (or nothing, on the missing-fields path) AND `ucEventLogs` (Task 14+
 * follow-up: webhook-delivery visibility), so a single-capture fake would
 * silently drop everything but the final insert.
 */
function fakeTrx() {
  const calls: Call[] = [];
  const trx = {
    insertInto: (table: string) => ({
      values: (values: Record<string, unknown>) => {
        const call: Call = { table, values };
        calls.push(call);
        return {
          onDuplicateKeyUpdate: (patch: Record<string, unknown>) => {
            call.onDuplicateKeyUpdate = patch;
            return { execute: async () => undefined };
          },
          execute: async () => undefined,
        };
      },
    }),
  } as unknown as Trx;
  return { trx, calls, findCall: (table: string) => calls.find((c) => c.table === table) };
}

describe('UcProductSyncHandler', () => {
  it('subscribes to the topic passed into its constructor', () => {
    const handler = new UcProductSyncHandler(UC_WEBHOOK_TOPICS.productCreate);
    expect(handler.topic).toBe(UC_WEBHOOK_TOPICS.productCreate);
  });

  it('upserts uc_sku_cache directly via trx (not via UcSkuCacheService)', async () => {
    const handler = new UcProductSyncHandler(UC_WEBHOOK_TOPICS.productUpdate);
    const { trx, findCall } = fakeTrx();

    await handler.handle(
      { sku: 'SKU-1', id: 'variant-1', product_id: 'product-1' },
      'merchant-1',
      trx,
    );

    const skuCacheCall = findCall('ucSkuCache');
    expect(skuCacheCall?.values).toMatchObject({
      merchantId: 'merchant-1',
      sku: 'SKU-1',
      ratioVariantId: 'variant-1',
      ratioProductId: 'product-1',
    });
    expect(skuCacheCall?.onDuplicateKeyUpdate).toMatchObject({
      ratioVariantId: 'variant-1',
      ratioProductId: 'product-1',
    });
  });

  it('logs a success event-log row alongside the sku_cache write (dashboard webhook visibility)', async () => {
    const handler = new UcProductSyncHandler(UC_WEBHOOK_TOPICS.productUpdate);
    const { trx, findCall } = fakeTrx();

    await handler.handle(
      { sku: 'SKU-1', id: 'variant-1', product_id: 'product-1' },
      'merchant-1',
      trx,
    );

    const eventLogCall = findCall('ucEventLogs');
    expect(eventLogCall?.values).toMatchObject({
      merchantId: 'merchant-1',
      direction: 'inbound',
      flow: 'webhook',
      reference: `${UC_WEBHOOK_TOPICS.productUpdate}: SKU-1`,
      result: 'success',
    });
  });

  it('is a no-op when merchantId is null', async () => {
    const handler = new UcProductSyncHandler(UC_WEBHOOK_TOPICS.productCreate);
    const { trx, calls } = fakeTrx();

    await handler.handle({ sku: 'SKU-1', id: 'variant-1', product_id: 'product-1' }, null, trx);

    expect(calls).toHaveLength(0);
  });

  it('logs a failed event-log row (but no sku_cache write) when sku/id/product_id are missing', async () => {
    const handler = new UcProductSyncHandler(UC_WEBHOOK_TOPICS.productCreate);
    const { trx, calls, findCall } = fakeTrx();

    await handler.handle({ sku: 'SKU-1' }, 'merchant-1', trx);

    expect(findCall('ucSkuCache')).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(findCall('ucEventLogs')?.values).toMatchObject({
      merchantId: 'merchant-1',
      direction: 'inbound',
      flow: 'webhook',
      result: 'failed',
    });
  });
});
