import type { Transaction } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseWithMerchants } from '../../../../src/core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../../src/core/webhooks/webhook-log.types';
import {
  UC_ORDER_WEBHOOK_TOPICS,
  UcOrderConfirmedHandler,
} from '../../../../src/modules/unicommerce/webhooks/order-confirmed.handler';

type Trx = Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>;

interface Call {
  table: string;
  values: Record<string, unknown>;
}

/**
 * Fake trx recording EVERY `.insertInto(...)` call — the handler now writes
 * both `ucSyncJobs` AND `ucEventLogs` (webhook-delivery visibility,
 * Task 14+ follow-up), so a single-capture fake would silently drop one.
 */
function enabledFlags() {
  return { isEnabled: vi.fn().mockResolvedValue(true) };
}

function fakeTrx() {
  const calls: Call[] = [];
  const trx = {
    insertInto: (table: string) => ({
      values: (values: Record<string, unknown>) => {
        calls.push({ table, values });
        return { execute: async () => undefined };
      },
    }),
  } as unknown as Trx;
  return { trx, calls, findCall: (table: string) => calls.find((c) => c.table === table) };
}

describe('UcOrderConfirmedHandler', () => {
  it('subscribes to orders/create', () => {
    const handler = new UcOrderConfirmedHandler(
      { generate: vi.fn() } as never,
      {
        publish: vi.fn(),
      } as never,
      enabledFlags() as never,
    );
    expect(handler.topic).toBe(UC_ORDER_WEBHOOK_TOPICS.orderCreated);
    expect(handler.topic).toBe('orders/create');
  });

  it("generates an orderItemId per line item and enqueues a uc_sync_jobs row via trx, payload matching UC's real POST uc/v1/order contract", async () => {
    const generate = vi.fn().mockResolvedValueOnce('item-a').mockResolvedValueOnce('item-b');
    const publish = vi.fn().mockResolvedValue(undefined);
    const handler = new UcOrderConfirmedHandler(
      { generate } as never,
      { publish } as never,
      enabledFlags() as never,
    );
    const { trx, findCall } = fakeTrx();

    await handler.handle(
      {
        id: 'order-1',
        name: '#1001',
        created_at: '2026-01-05T10:30:00.000Z',
        email: 'buyer@example.com',
        payment_gateway_names: ['razorpay'],
        total_discounts: 50,
        shipping_lines: [{ price: 40 }],
        shipping_address: {
          first_name: 'Jane',
          last_name: 'Doe',
          address1: '221B Baker St',
          city: 'Mumbai',
          province: 'Maharashtra',
          country: 'India',
          zip: '400001',
          phone: '9999999999',
        },
        billing_address: {
          first_name: 'Jane',
          last_name: 'Doe',
          address1: '221B Baker St',
          city: 'Mumbai',
          province: 'Maharashtra',
          country: 'India',
          zip: '400001',
          phone: '9999999999',
        },
        line_items: [
          {
            id: 'li-1',
            product_id: 'prod-1',
            variant_id: 'var-1',
            sku: 'SKU-1',
            title: 'T-Shirt',
            quantity: 2,
            price: '10.00',
          },
          {
            id: 'li-2',
            product_id: 'prod-2',
            variant_id: 'var-2',
            sku: 'SKU-2',
            title: 'Shorts',
            quantity: 1,
            price: '5.00',
            discount_allocations: [{ amount: '1.00' }],
          },
        ],
      },
      'merchant-1',
      trx,
    );

    expect(generate).toHaveBeenNthCalledWith(
      1,
      'merchant-1',
      'order-1',
      'li-1',
      2,
      'ratio_originated',
    );
    expect(generate).toHaveBeenNthCalledWith(
      2,
      'merchant-1',
      'order-1',
      'li-2',
      1,
      'ratio_originated',
    );

    const syncJobsCall = findCall('ucSyncJobs');
    expect(syncJobsCall?.values).toMatchObject({
      merchantId: 'merchant-1',
      type: 'order_push',
      ratioOrderId: 'order-1',
      status: 'PENDING',
    });
    expect(typeof syncJobsCall?.values.id).toBe('string');
    expect((syncJobsCall?.values.id as string).length).toBeGreaterThan(0);

    // `payload` is stringified before insert (mysql2 doesn't auto-serialize
    // JS objects into JSON columns) — parse it back to assert on its shape.
    expect(typeof syncJobsCall?.values.payload).toBe('string');
    const payload = JSON.parse(syncJobsCall?.values.payload as string) as {
      merchantId: string;
      ratioOrderId: string;
      order: Record<string, unknown>;
    };

    // Bookkeeping fields — used by UcSyncQueueService/UcOrderPushWorkerService,
    // never sent to UC directly (kept out of the `order` object below).
    expect(payload.merchantId).toBe('merchant-1');
    expect(payload.ratioOrderId).toBe('order-1');

    // TRD §2.9 — real UC uc/v1/order contract, NOT the old saleOrderDTO wrapper.
    const order = payload.order;
    expect(order.id).toBe('order-1');
    expect(order.displayOrderNumber).toBe('#1001');
    expect(order.orderDate).toBe('2026-01-05 16:00:00'); // 10:30 UTC + 5:30 IST
    expect(order.orderStatus).toBe('CREATED');
    expect(order.sla).toBe('2026-01-07 16:00:00'); // default +2 days offset
    expect(order.priority).toBe(0);
    expect(order.paymentType).toBe('PREPAID');
    expect(order.taxExempted).toBe(false);
    expect(order.cFormProvided).toBe(false);
    expect(order.thirdPartyShipping).toBe(false);
    expect(order.orderPrice).toEqual({
      currency: 'INR',
      totalDiscount: 50,
      totalShippingCharges: 40,
    });
    expect(order.shippingAddress).toEqual({
      addressLine1: '221B Baker St',
      addressLine2: undefined,
      city: 'Mumbai',
      country: 'India',
      email: 'buyer@example.com',
      name: 'Jane Doe',
      phone: '9999999999',
      pincode: '400001',
      state: 'Maharashtra',
    });
    expect(order.billingAddress).toEqual(order.shippingAddress);
    expect(order.orderItems).toEqual([
      {
        orderItemId: 'item-a',
        productId: 'prod-1',
        variantId: 'var-1',
        sku: 'SKU-1',
        title: 'T-Shirt',
        quantity: 2,
        shippingMethodCode: 'STD',
        orderItemPrice: { sellingPrice: 10, totalPrice: 20, discount: 0 },
      },
      {
        orderItemId: 'item-b',
        productId: 'prod-2',
        variantId: 'var-2',
        sku: 'SKU-2',
        title: 'Shorts',
        quantity: 1,
        shippingMethodCode: 'STD',
        orderItemPrice: { sellingPrice: 5, totalPrice: 4, discount: 1 },
      },
    ]);

    // Webhook-delivery visibility (Task 14+ follow-up): distinct from the
    // outbound order_push event UcSyncQueueService logs once the push
    // itself resolves — this row is the webhook receipt.
    const eventLogCall = findCall('ucEventLogs');
    expect(eventLogCall?.values).toMatchObject({
      merchantId: 'merchant-1',
      direction: 'inbound',
      flow: 'webhook',
      reference: 'orders/create: order-1',
      result: 'success',
    });

    // Fast path: the freshly-enqueued job's Kafka publish must be triggered,
    // not left PENDING with nothing ever picking it up.
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(syncJobsCall?.values.id, {
      merchantId: 'merchant-1',
      type: 'order_push',
      ratioOrderId: 'order-1',
    });
  });

  it('is a no-op when merchantId is null', async () => {
    const generate = vi.fn();
    const publish = vi.fn();
    const handler = new UcOrderConfirmedHandler(
      { generate } as never,
      { publish } as never,
      enabledFlags() as never,
    );
    const { trx, calls } = fakeTrx();

    await handler.handle({ id: 'order-1', name: '#1001', line_items: [] }, null, trx);

    expect(generate).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not let a rejected fast-path call propagate or go unhandled', async () => {
    const generate = vi.fn();
    const publish = vi.fn().mockRejectedValue(new Error('boom'));
    const handler = new UcOrderConfirmedHandler(
      { generate } as never,
      { publish } as never,
      enabledFlags() as never,
    );
    const { trx } = fakeTrx();

    await expect(
      handler.handle({ id: 'order-1', name: '#1001', line_items: [] }, 'merchant-1', trx),
    ).resolves.toBeUndefined();

    // Let the fire-and-forget rejection's .catch() microtask run.
    await new Promise((r) => setTimeout(r, 0));
    expect(publish).toHaveBeenCalledTimes(1);
  });

  // TRD §6: order_push flag off → the true earliest gate fires before any
  // work happens: no orderItemId mapping rows are generated (they'd be pure
  // garbage — UC never learns about an order that was never pushed to it),
  // no uc_sync_jobs row, no Kafka publish. A webhook-delivery event IS still
  // logged so the disabled path stays visible in the admin dashboard.
  it('does not generate orderItemId mappings or enqueue a push, but logs a webhook event, when order_push is disabled', async () => {
    const generate = vi.fn();
    const publish = vi.fn();
    const flags = { isEnabled: vi.fn().mockResolvedValue(false) };
    const handler = new UcOrderConfirmedHandler(
      { generate } as never,
      { publish } as never,
      flags as never,
    );
    const { trx, findCall } = fakeTrx();

    await handler.handle(
      {
        id: 'order-1',
        name: '#1001',
        created_at: '2026-01-05T10:30:00.000Z',
        line_items: [
          {
            id: 'li-1',
            product_id: 'prod-1',
            variant_id: 'var-1',
            sku: 'SKU-1',
            title: 'T-Shirt',
            quantity: 1,
            price: '10.00',
          },
        ],
      },
      'merchant-1',
      trx,
    );

    expect(flags.isEnabled).toHaveBeenCalledWith('order_push', 'merchant-1');
    expect(generate).not.toHaveBeenCalled();
    expect(findCall('ucSyncJobs')).toBeUndefined();
    expect(publish).not.toHaveBeenCalled();
    expect(findCall('ucEventLogs')?.values).toMatchObject({
      merchantId: 'merchant-1',
      direction: 'inbound',
      flow: 'webhook',
      reference: 'orders/create: order-1',
      result: 'success',
    });
  });
});
