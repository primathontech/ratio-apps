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
 * `handle()` invocation, not just the last one — the handler writes both
 * `ucSkuCache` (one row per variant) AND `ucEventLogs` (Task 14+ follow-up:
 * webhook-delivery visibility), so a single-capture fake would silently drop
 * everything but the final insert.
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

// Real Ratio product webhook payload (the envelope's `product` object,
// confirmed live 2026-08-06 against `GET /api/v1/v1/products`): the product
// id sits at `data.id`, and each variant's own id + sku sit nested under
// `data.variants[]` — there is NO top-level `data.sku`/`data.product_id` on
// the envelope itself. The handler used to read fields that don't exist on
// this real shape at all.
describe('UcProductSyncHandler', () => {
  it('subscribes to the topic passed into its constructor', () => {
    const handler = new UcProductSyncHandler(UC_WEBHOOK_TOPICS.productCreate);
    expect(handler.topic).toBe(UC_WEBHOOK_TOPICS.productCreate);
  });

  it('upserts uc_sku_cache for every variant on the real nested product payload (not via UcSkuCacheService)', async () => {
    const handler = new UcProductSyncHandler(UC_WEBHOOK_TOPICS.productUpdate);
    const { trx, calls } = fakeTrx();

    await handler.handle(
      {
        id: 'product-1',
        title: 'Test product',
        variants: [
          { id: 'variant-1', sku: 'SKU-1' },
          { id: 'variant-2', sku: 'SKU-2' },
        ],
      },
      'merchant-1',
      trx,
    );

    const skuCacheCalls = calls.filter((c) => c.table === 'ucSkuCache');
    expect(skuCacheCalls).toHaveLength(2);
    expect(skuCacheCalls[0]?.values).toMatchObject({
      merchantId: 'merchant-1',
      sku: 'SKU-1',
      ratioVariantId: 'variant-1',
      ratioProductId: 'product-1',
    });
    expect(skuCacheCalls[0]?.onDuplicateKeyUpdate).toMatchObject({
      ratioVariantId: 'variant-1',
      ratioProductId: 'product-1',
    });
    expect(skuCacheCalls[1]?.values).toMatchObject({
      merchantId: 'merchant-1',
      sku: 'SKU-2',
      ratioVariantId: 'variant-2',
      ratioProductId: 'product-1',
    });
  });

  it('logs one success event-log row for the whole product event, not one per variant', async () => {
    const handler = new UcProductSyncHandler(UC_WEBHOOK_TOPICS.productUpdate);
    const { trx, calls } = fakeTrx();

    await handler.handle(
      {
        id: 'product-1',
        variants: [
          { id: 'variant-1', sku: 'SKU-1' },
          { id: 'variant-2', sku: 'SKU-2' },
        ],
      },
      'merchant-1',
      trx,
    );

    const eventLogCalls = calls.filter((c) => c.table === 'ucEventLogs');
    expect(eventLogCalls).toHaveLength(1);
    expect(eventLogCalls[0]?.values).toMatchObject({
      merchantId: 'merchant-1',
      direction: 'inbound',
      flow: 'webhook',
      reference: `${UC_WEBHOOK_TOPICS.productUpdate}: product-1`,
      result: 'success',
    });
  });

  it('is a no-op when merchantId is null', async () => {
    const handler = new UcProductSyncHandler(UC_WEBHOOK_TOPICS.productCreate);
    const { trx, calls } = fakeTrx();

    await handler.handle(
      { id: 'product-1', variants: [{ id: 'variant-1', sku: 'SKU-1' }] },
      null,
      trx,
    );

    expect(calls).toHaveLength(0);
  });

  it('logs a failed event-log row (but no sku_cache write) when the product has no id or no variants at all', async () => {
    const handler = new UcProductSyncHandler(UC_WEBHOOK_TOPICS.productCreate);
    const { trx, calls, findCall } = fakeTrx();

    await handler.handle({ id: 'product-1', variants: [] }, 'merchant-1', trx);

    expect(findCall('ucSkuCache')).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(findCall('ucEventLogs')?.values).toMatchObject({
      merchantId: 'merchant-1',
      direction: 'inbound',
      flow: 'webhook',
      result: 'failed',
    });
  });

  it('skips an individual variant missing sku/id but still upserts the rest', async () => {
    const handler = new UcProductSyncHandler(UC_WEBHOOK_TOPICS.productUpdate);
    const { trx, calls } = fakeTrx();

    await handler.handle(
      {
        id: 'product-1',
        variants: [
          { id: 'variant-1', sku: 'SKU-1' },
          { id: undefined, sku: undefined },
        ],
      },
      'merchant-1',
      trx,
    );

    const skuCacheCalls = calls.filter((c) => c.table === 'ucSkuCache');
    expect(skuCacheCalls).toHaveLength(1);
    expect(skuCacheCalls[0]?.values).toMatchObject({ sku: 'SKU-1', ratioVariantId: 'variant-1' });
  });
});
