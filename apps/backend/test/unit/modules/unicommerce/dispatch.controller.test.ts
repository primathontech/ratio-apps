import { describe, expect, it, vi } from 'vitest';
import {
  dispatchSchema,
  UcDispatchController,
} from '../../../../src/modules/unicommerce/controllers/dispatch.controller';

function enabledFlags() {
  return { isEnabled: vi.fn().mockResolvedValue(true) };
}

describe('dispatchSchema', () => {
  it('rejects an empty orderItems array rather than allowing a vacuous SUCCESS report', () => {
    const result = dispatchSchema.safeParse({
      orderItems: [],
      selfShipping: {
        deliveryPartner: 'Self',
        deliveryCourier: 'Delhivery',
        dispatchDate: '2026-07-20',
        invoiceNumber: 'INV-1',
        invoiceDate: '2026-07-20',
        trackingId: 'AWB123',
        trackingURL: 'https://track.example.com/AWB123',
        tentativeDeliveryDate: '2026-07-23',
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts UC's real 6-field GST/tax shape (no gstPercentage field exists in UC's real contract)", () => {
    const result = dispatchSchema.safeParse({
      orderItems: [
        {
          orderItemId: 'item-1',
          quantity: 1,
          taxRate: 18,
          centralGstPercentage: 9,
          stateGstPercentage: 9,
          unionTerritoryGstPercentage: 0,
          integratedGstPercentage: 0,
          compensationCessPercentage: 0,
        },
      ],
      selfShipping: {
        deliveryPartner: 'Self',
        deliveryCourier: 'Delhivery',
        dispatchDate: '2026-07-20',
        invoiceNumber: 'INV-1',
        invoiceDate: '2026-07-20',
        trackingId: 'AWB123',
        trackingURL: 'https://track.example.com/AWB123',
        tentativeDeliveryDate: '2026-07-23',
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts an orderItem with NO tax fields at all — UC only sends them "as applied"', () => {
    const result = dispatchSchema.safeParse({
      orderItems: [{ orderItemId: 'item-1', quantity: 1 }],
      selfShipping: {
        deliveryPartner: 'Self',
        deliveryCourier: 'Delhivery',
        dispatchDate: '2026-07-20',
        invoiceNumber: 'INV-1',
        invoiceDate: '2026-07-20',
        trackingId: 'AWB123',
        trackingURL: 'https://track.example.com/AWB123',
        tentativeDeliveryDate: '2026-07-23',
      },
    });

    expect(result.success).toBe(true);
  });
});

describe('UcDispatchController.dispatch', () => {
  it('marks the Ratio order fulfilled and writes tracking into metafields', async () => {
    const orderItemMap = {
      resolveFull: vi.fn().mockResolvedValue({
        orderItemId: 'item-1',
        merchantId: 'm1',
        ratioOrderId: 'order-1',
        ratioLineItemId: 'line-1',
        orderedQuantity: 2,
        remainingQuantity: 2,
        lastStatus: null,
        lastStatusUpdatedAt: null,
        saleOrderCode: null,
        source: 'ratio_originated',
      }),
      findByRatioOrder: vi.fn().mockResolvedValue([]),
      decrementRemainingQuantity: vi.fn().mockResolvedValue(undefined),
    };
    const ratio = { updateOrderFulfillment: vi.fn().mockResolvedValue(undefined) };
    const controller = new UcDispatchController(
      orderItemMap as never,
      ratio as never,
      { record: vi.fn() } as never,
      enabledFlags() as never,
    );

    const result = await controller.dispatch({ ucMerchantId: 'm1' } as never, {
      orderItems: [{ orderItemId: 'item-1', taxRate: 18, quantity: 1 }],
      selfShipping: {
        deliveryPartner: 'Self',
        deliveryCourier: 'Delhivery',
        dispatchDate: '2026-07-20',
        invoiceNumber: 'INV-1',
        invoiceDate: '2026-07-20',
        trackingId: 'AWB123',
        trackingURL: 'https://track.example.com/AWB123',
        tentativeDeliveryDate: '2026-07-23',
      },
    });

    expect(ratio.updateOrderFulfillment).toHaveBeenCalledWith('m1', 'order-1', {
      fulfillment_status: 'fulfilled',
      metafields: [
        { namespace: 'unicommerce', key: 'tracking_number', value: 'AWB123', type: 'string' },
        { namespace: 'unicommerce', key: 'courier', value: 'Delhivery', type: 'string' },
        { namespace: 'unicommerce', key: 'invoice_number', value: 'INV-1', type: 'string' },
        { namespace: 'unicommerce', key: 'invoice_date', value: '2026-07-20', type: 'string' },
      ],
    });
    expect(result).toEqual({ status: 'SUCCESS', orderItems: [{ orderItemId: 'item-1' }] });
  });

  it('reports an unresolvable orderItemId as a per-item error, not a thrown exception', async () => {
    const orderItemMap = { resolveFull: vi.fn().mockResolvedValue(null) };
    const ratio = { updateOrderFulfillment: vi.fn() };
    const controller = new UcDispatchController(
      orderItemMap as never,
      ratio as never,
      { record: vi.fn() } as never,
      enabledFlags() as never,
    );

    const result = await controller.dispatch({ ucMerchantId: 'm1' } as never, {
      orderItems: [{ orderItemId: 'unknown-item', taxRate: 18, quantity: 1 }],
      selfShipping: {
        deliveryPartner: 'Self',
        deliveryCourier: 'Delhivery',
        dispatchDate: '2026-07-20',
        invoiceNumber: 'INV-1',
        invoiceDate: '2026-07-20',
        trackingId: 'AWB123',
        trackingURL: 'https://track.example.com/AWB123',
        tentativeDeliveryDate: '2026-07-23',
      },
    });

    expect(ratio.updateOrderFulfillment).not.toHaveBeenCalled();
    // Fix 4: every item in this single-item batch failed, so the rollup must
    // report FAILED, not PARTIAL_SUCCESS.
    expect(result).toEqual({
      status: 'FAILED',
      orderItems: [{ orderItemId: 'unknown-item', errorMessage: 'unknown orderItemId' }],
    });
  });

  it('treats a mapping that belongs to a different merchant as unknown, without calling updateOrderFulfillment', async () => {
    const orderItemMap = {
      resolveFull: vi.fn().mockResolvedValue({
        orderItemId: 'foreign-item',
        merchantId: 'other-merchant',
        ratioOrderId: 'order-1',
        ratioLineItemId: 'line-1',
        orderedQuantity: 2,
        remainingQuantity: 2,
        lastStatus: null,
        lastStatusUpdatedAt: null,
        saleOrderCode: null,
        source: 'ratio_originated',
      }),
    };
    const ratio = { updateOrderFulfillment: vi.fn() };
    const controller = new UcDispatchController(
      orderItemMap as never,
      ratio as never,
      { record: vi.fn() } as never,
      enabledFlags() as never,
    );

    const result = await controller.dispatch({ ucMerchantId: 'm1' } as never, {
      orderItems: [{ orderItemId: 'foreign-item', taxRate: 18, quantity: 1 }],
      selfShipping: {
        deliveryPartner: 'Self',
        deliveryCourier: 'Delhivery',
        dispatchDate: '2026-07-20',
        invoiceNumber: 'INV-1',
        invoiceDate: '2026-07-20',
        trackingId: 'AWB123',
        trackingURL: 'https://track.example.com/AWB123',
        tentativeDeliveryDate: '2026-07-23',
      },
    });

    expect(ratio.updateOrderFulfillment).not.toHaveBeenCalled();
    // Fix 4: every item in this single-item batch failed, so the rollup must
    // report FAILED, not PARTIAL_SUCCESS.
    expect(result).toEqual({
      status: 'FAILED',
      orderItems: [{ orderItemId: 'foreign-item', errorMessage: 'unknown orderItemId' }],
    });
  });

  it('dedups by ratioOrderId: calls updateOrderFulfillment once even when multiple order items map to the same order', async () => {
    const orderItemMap = {
      resolveFull: vi.fn().mockResolvedValue({
        orderItemId: 'item-1',
        merchantId: 'm1',
        ratioOrderId: 'order-1',
        ratioLineItemId: 'line-1',
        orderedQuantity: 2,
        remainingQuantity: 2,
        lastStatus: null,
        lastStatusUpdatedAt: null,
        saleOrderCode: null,
        source: 'ratio_originated',
      }),
      findByRatioOrder: vi.fn().mockResolvedValue([]),
      decrementRemainingQuantity: vi.fn().mockResolvedValue(undefined),
    };
    const ratio = { updateOrderFulfillment: vi.fn().mockResolvedValue(undefined) };
    const controller = new UcDispatchController(
      orderItemMap as never,
      ratio as never,
      { record: vi.fn() } as never,
      enabledFlags() as never,
    );

    const result = await controller.dispatch({ ucMerchantId: 'm1' } as never, {
      orderItems: [
        { orderItemId: 'item-1', taxRate: 18, quantity: 1 },
        { orderItemId: 'item-2', taxRate: 18, quantity: 1 },
      ],
      selfShipping: {
        deliveryPartner: 'Self',
        deliveryCourier: 'Delhivery',
        dispatchDate: '2026-07-20',
        invoiceNumber: 'INV-1',
        invoiceDate: '2026-07-20',
        trackingId: 'AWB123',
        trackingURL: 'https://track.example.com/AWB123',
        tentativeDeliveryDate: '2026-07-23',
      },
    });

    expect(ratio.updateOrderFulfillment).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: 'SUCCESS',
      orderItems: [{ orderItemId: 'item-1' }, { orderItemId: 'item-2' }],
    });
  });

  // Fix 2: an event-log write failure must never turn this real success into
  // a rejected request handler.
  it('still returns the correct success response when eventLog.record() rejects (Fix 2)', async () => {
    const orderItemMap = {
      resolveFull: vi.fn().mockResolvedValue({
        orderItemId: 'item-1',
        merchantId: 'm1',
        ratioOrderId: 'order-1',
        ratioLineItemId: 'line-1',
        orderedQuantity: 2,
        remainingQuantity: 2,
        lastStatus: null,
        lastStatusUpdatedAt: null,
        saleOrderCode: null,
        source: 'ratio_originated',
      }),
      findByRatioOrder: vi.fn().mockResolvedValue([]),
      decrementRemainingQuantity: vi.fn().mockResolvedValue(undefined),
    };
    const ratio = { updateOrderFulfillment: vi.fn().mockResolvedValue(undefined) };
    const eventLog = { record: vi.fn().mockRejectedValue(new Error('transient DB error')) };
    const controller = new UcDispatchController(
      orderItemMap as never,
      ratio as never,
      eventLog as never,
      enabledFlags() as never,
    );

    const result = await controller.dispatch({ ucMerchantId: 'm1' } as never, {
      orderItems: [{ orderItemId: 'item-1', taxRate: 18, quantity: 1 }],
      selfShipping: {
        deliveryPartner: 'Self',
        deliveryCourier: 'Delhivery',
        dispatchDate: '2026-07-20',
        invoiceNumber: 'INV-1',
        invoiceDate: '2026-07-20',
        trackingId: 'AWB123',
        trackingURL: 'https://track.example.com/AWB123',
        tentativeDeliveryDate: '2026-07-23',
      },
    });

    expect(result).toEqual({ status: 'SUCCESS', orderItems: [{ orderItemId: 'item-1' }] });
  });

  // TRD §6: dispatch_status_sync flag off → accept-and-no-op, never hard-reject.
  it('returns a no-op SUCCESS without touching the order-item map or Ratio when dispatch_status_sync is disabled', async () => {
    const orderItemMap = { resolveFull: vi.fn() };
    const ratio = { updateOrderFulfillment: vi.fn() };
    const flags = { isEnabled: vi.fn().mockResolvedValue(false) };
    const controller = new UcDispatchController(
      orderItemMap as never,
      ratio as never,
      { record: vi.fn() } as never,
      flags as never,
    );

    const result = await controller.dispatch({ ucMerchantId: 'm1' } as never, {
      orderItems: [{ orderItemId: 'item-1', taxRate: 18, quantity: 1 }],
      selfShipping: {
        deliveryPartner: 'Self',
        deliveryCourier: 'Delhivery',
        dispatchDate: '2026-07-20',
        invoiceNumber: 'INV-1',
        invoiceDate: '2026-07-20',
        trackingId: 'AWB123',
        trackingURL: 'https://track.example.com/AWB123',
        tentativeDeliveryDate: '2026-07-23',
      },
    });

    expect(flags.isEnabled).toHaveBeenCalledWith('dispatch_status_sync', 'm1');
    expect(orderItemMap.resolveFull).not.toHaveBeenCalled();
    expect(ratio.updateOrderFulfillment).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'SUCCESS', orderItems: [{ orderItemId: 'item-1' }] });
  });

  // Found via local verification: a downstream Ratio-call failure (network
  // error, expired OAuth token, Ratio 5xx) must degrade to a per-item error,
  // not an uncaught exception crashing the whole batch with a raw 500.
  it('reports a downstream Ratio-call failure as a per-item error, not an uncaught exception', async () => {
    const orderItemMap = {
      resolveFull: vi.fn().mockResolvedValue({
        orderItemId: 'item-1',
        merchantId: 'm1',
        ratioOrderId: 'order-1',
        ratioLineItemId: 'line-1',
        orderedQuantity: 2,
        remainingQuantity: 2,
        lastStatus: null,
        lastStatusUpdatedAt: null,
        saleOrderCode: null,
        source: 'ratio_originated',
      }),
      findByRatioOrder: vi.fn().mockResolvedValue([]),
      decrementRemainingQuantity: vi.fn().mockResolvedValue(undefined),
    };
    const ratio = {
      updateOrderFulfillment: vi
        .fn()
        .mockRejectedValue(new Error('no Ratio oauth_tokens row for merchant m1')),
    };
    const controller = new UcDispatchController(
      orderItemMap as never,
      ratio as never,
      { record: vi.fn() } as never,
      enabledFlags() as never,
    );

    const result = await controller.dispatch({ ucMerchantId: 'm1' } as never, {
      orderItems: [{ orderItemId: 'item-1', taxRate: 18, quantity: 1 }],
      selfShipping: {
        deliveryPartner: 'Self',
        deliveryCourier: 'Delhivery',
        dispatchDate: '2026-07-20',
        invoiceNumber: 'INV-1',
        invoiceDate: '2026-07-20',
        trackingId: 'AWB123',
        trackingURL: 'https://track.example.com/AWB123',
        tentativeDeliveryDate: '2026-07-23',
      },
    });

    expect(orderItemMap.decrementRemainingQuantity).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'FAILED',
      orderItems: [{ orderItemId: 'item-1', errorMessage: 'failed to apply update' }],
    });
  });
});
