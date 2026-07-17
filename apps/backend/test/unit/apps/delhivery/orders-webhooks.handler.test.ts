import type { Transaction } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseWithMerchants } from '../../../../src/core/merchants/merchant.types';
import type { QueueService } from '../../../../src/core/queue/queue.service';
import type { DatabaseWithWebhookLog } from '../../../../src/core/webhooks/webhook-log.types';
import { DELHIVERY_QUEUE_NAMES } from '../../../../src/modules/delhivery/shipments/shipment-create.queue';
import { DelhiveryOrdersCancelledHandler } from '../../../../src/modules/delhivery/webhooks/orders-cancelled.handler';
import { DelhiveryOrdersEditedHandler } from '../../../../src/modules/delhivery/webhooks/orders-edited.handler';
import { DelhiveryOrdersPaidHandler } from '../../../../src/modules/delhivery/webhooks/orders-paid.handler';
import { DELHIVERY_WEBHOOK_TOPICS, isRatioOrigin } from '../../../../src/modules/delhivery/webhooks/topics';

const trx = {} as Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>;

function fakeQueue() {
  return { sendBatch: vi.fn(async () => undefined) } as unknown as QueueService;
}

const paidOrder = { id: 'ord_1', order_number: 1001, source: 'Online Store' };

describe('DelhiveryOrdersPaidHandler', () => {
  it('subscribes to the slash-form orders/paid topic', () => {
    expect(new DelhiveryOrdersPaidHandler(fakeQueue()).topic).toBe('orders/paid');
  });

  it('enqueues a create op for a Ratio-origin paid order', async () => {
    const queue = fakeQueue();
    await new DelhiveryOrdersPaidHandler(queue).handle(paidOrder, 'm1', trx);

    expect(queue.sendBatch).toHaveBeenCalledWith(DELHIVERY_QUEUE_NAMES.shipments, [
      { op: 'create', merchantId: 'm1', orderId: 'ord_1', orderNumber: '1001' },
    ]);
  });

  it('worker.paid.guardSource — explicitly non-Ratio-origin orders are skipped', async () => {
    const queue = fakeQueue();
    const handler = new DelhiveryOrdersPaidHandler(queue);
    await handler.handle({ ...paidOrder, source: 'shopify_draft_order' }, 'm1', trx);
    expect(queue.sendBatch).not.toHaveBeenCalled();
  });

  it('processes the real payload shape, which carries NO source field (verified OpenAPI spec)', async () => {
    const queue = fakeQueue();
    // Verified order-created payload: flat order, no `source` key at all.
    await new DelhiveryOrdersPaidHandler(queue).handle(
      {
        id: 'ordr_9',
        order_number: 1009,
        financial_status: 'paid',
        total_price: '499.00',
        shipping_address: { city: 'Delhi' },
        line_items: [{ product_id: 'prod_1', quantity: 1 }],
      },
      'm1',
      trx,
    );
    expect(queue.sendBatch).toHaveBeenCalledWith(DELHIVERY_QUEUE_NAMES.shipments, [
      { op: 'create', merchantId: 'm1', orderId: 'ordr_9', orderNumber: '1009' },
    ]);
  });

  it('skips when merchantId is null or the order id is missing', async () => {
    const queue = fakeQueue();
    const handler = new DelhiveryOrdersPaidHandler(queue);
    await handler.handle(paidOrder, null, trx);
    await handler.handle({ source: 'Online Store' }, 'm1', trx);
    expect(queue.sendBatch).not.toHaveBeenCalled();
  });
});

describe('DelhiveryOrdersCancelledHandler', () => {
  it('webhook.cancelledCancelsAwb — enqueues the cancel op the worker executes', async () => {
    const queue = fakeQueue();
    const handler = new DelhiveryOrdersCancelledHandler(queue);
    expect(handler.topic).toBe(DELHIVERY_WEBHOOK_TOPICS.ordersCancelled);

    await handler.handle({ id: 'ord_1', order_number: '1001' }, 'm1', trx);

    expect(queue.sendBatch).toHaveBeenCalledWith(DELHIVERY_QUEUE_NAMES.shipments, [
      { op: 'cancel', merchantId: 'm1', orderId: 'ord_1', orderNumber: '1001' },
    ]);
  });

  it('handles the real cancel payload {orderId, externalOrderId} (IDs only, camelCase)', async () => {
    const queue = fakeQueue();
    await new DelhiveryOrdersCancelledHandler(queue).handle(
      { orderId: 'ordr_42', externalOrderId: 'ext_99' },
      'm1',
      trx,
    );
    expect(queue.sendBatch).toHaveBeenCalledWith(DELHIVERY_QUEUE_NAMES.shipments, [
      { op: 'cancel', merchantId: 'm1', orderId: 'ordr_42' },
    ]);
  });

  it('falls back to snake_case ids and then externalOrderId when orderId is absent', async () => {
    const queue = fakeQueue();
    const handler = new DelhiveryOrdersCancelledHandler(queue);
    await handler.handle({ external_order_id: 'ext_7' }, 'm1', trx);
    expect(queue.sendBatch).toHaveBeenCalledWith(DELHIVERY_QUEUE_NAMES.shipments, [
      { op: 'cancel', merchantId: 'm1', orderId: 'ext_7' },
    ]);
  });

  it('skips when no id of any shape is present', async () => {
    const queue = fakeQueue();
    await new DelhiveryOrdersCancelledHandler(queue).handle({}, 'm1', trx);
    expect(queue.sendBatch).not.toHaveBeenCalled();
  });
});

describe('DelhiveryOrdersEditedHandler', () => {
  it('enqueues a recreate op for edited orders', async () => {
    const queue = fakeQueue();
    const handler = new DelhiveryOrdersEditedHandler(queue);
    expect(handler.topic).toBe(DELHIVERY_WEBHOOK_TOPICS.ordersEdited);

    await handler.handle({ id: 'ord_1' }, 'm1', trx);

    expect(queue.sendBatch).toHaveBeenCalledWith(DELHIVERY_QUEUE_NAMES.shipments, [
      { op: 'recreate', merchantId: 'm1', orderId: 'ord_1' },
    ]);
  });
});

describe('isRatioOrigin', () => {
  it('accepts the verified dashboard value "Online Store" (case-insensitive)', () => {
    expect(isRatioOrigin('Online Store')).toBe(true);
    expect(isRatioOrigin('online store')).toBe(true);
    expect(isRatioOrigin('ratio')).toBe(true);
  });
  it('rejects Shopify/unknown sources', () => {
    expect(isRatioOrigin('shopify')).toBe(false);
    expect(isRatioOrigin('')).toBe(false);
    expect(isRatioOrigin(undefined)).toBe(false);
  });
});
