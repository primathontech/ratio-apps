import { describe, expect, it, vi } from 'vitest';
import { UcOrderCancelController } from '../../../../src/modules/unicommerce/controllers/order-cancel.controller';

function enabledFlags() {
  return { isEnabled: vi.fn().mockResolvedValue(true) };
}

function fullItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
    ...overrides,
  };
}

describe('UcOrderCancelController.cancel', () => {
  it('resolves each orderItemId and cancels the matching Ratio order when it is the only item on the order', async () => {
    const item1 = fullItem();
    const orderItemMap = {
      resolveFull: vi.fn().mockResolvedValue(item1),
      findByRatioOrder: vi.fn().mockResolvedValue([item1]),
      markSource: vi.fn().mockResolvedValue(undefined),
      decrementRemainingQuantity: vi.fn().mockResolvedValue(undefined),
      updateLastStatus: vi.fn().mockResolvedValue(undefined),
    };
    const ratio = {
      cancelOrder: vi.fn().mockResolvedValue(undefined),
      updateOrderLineItems: vi.fn(),
    };
    const controller = new UcOrderCancelController(
      orderItemMap as never,
      ratio as never,
      { record: vi.fn() } as never,
      enabledFlags() as never,
    );

    const result = await controller.cancel({ ucMerchantId: 'm1' } as never, {
      orderId: 'UC-1',
      orderItems: [{ orderItemId: 'item-1', productId: 'p1', variantId: 'v1', quantity: 1 }],
    });

    expect(ratio.cancelOrder).toHaveBeenCalledWith('m1', 'order-1');
    expect(ratio.updateOrderLineItems).not.toHaveBeenCalled();
    expect(orderItemMap.markSource).toHaveBeenCalledWith('item-1', 'uc_originated');
    expect(result).toEqual({ status: 'SUCCESS', orderItems: [{ orderItemId: 'item-1' }] });
  });

  it('reports an unresolvable orderItemId as a per-item error, not a thrown exception', async () => {
    const orderItemMap = { resolveFull: vi.fn().mockResolvedValue(null) };
    const ratio = { cancelOrder: vi.fn(), updateOrderLineItems: vi.fn() };
    const controller = new UcOrderCancelController(
      orderItemMap as never,
      ratio as never,
      { record: vi.fn() } as never,
      enabledFlags() as never,
    );

    const result = await controller.cancel({ ucMerchantId: 'm1' } as never, {
      orderId: 'UC-1',
      orderItems: [{ orderItemId: 'unknown-item', productId: 'p1', variantId: 'v1', quantity: 1 }],
    });

    expect(ratio.cancelOrder).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'FAILED',
      orderItems: [{ orderItemId: 'unknown-item', errorMessage: 'unknown orderItemId' }],
    });
  });

  it('treats a mapping that belongs to a different merchant as unknown, without calling cancelOrder', async () => {
    const orderItemMap = {
      resolveFull: vi
        .fn()
        .mockResolvedValue(fullItem({ orderItemId: 'foreign-item', merchantId: 'other-merchant' })),
    };
    const ratio = { cancelOrder: vi.fn(), updateOrderLineItems: vi.fn() };
    const controller = new UcOrderCancelController(
      orderItemMap as never,
      ratio as never,
      { record: vi.fn() } as never,
      enabledFlags() as never,
    );

    const result = await controller.cancel({ ucMerchantId: 'm1' } as never, {
      orderId: 'UC-1',
      orderItems: [{ orderItemId: 'foreign-item', productId: 'p1', variantId: 'v1', quantity: 1 }],
    });

    expect(ratio.cancelOrder).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'FAILED',
      orderItems: [{ orderItemId: 'foreign-item', errorMessage: 'unknown orderItemId' }],
    });
  });

  it('reports PARTIAL_SUCCESS when only some items in the batch resolve, preserving input order', async () => {
    const item1 = fullItem();
    const orderItemMap = {
      resolveFull: vi
        .fn()
        .mockImplementation((orderItemId: string) =>
          orderItemId === 'item-1' ? Promise.resolve(item1) : Promise.resolve(null),
        ),
      findByRatioOrder: vi.fn().mockResolvedValue([item1]),
      markSource: vi.fn().mockResolvedValue(undefined),
      decrementRemainingQuantity: vi.fn().mockResolvedValue(undefined),
      updateLastStatus: vi.fn().mockResolvedValue(undefined),
    };
    const ratio = {
      cancelOrder: vi.fn().mockResolvedValue(undefined),
      updateOrderLineItems: vi.fn(),
    };
    const controller = new UcOrderCancelController(
      orderItemMap as never,
      ratio as never,
      { record: vi.fn() } as never,
      enabledFlags() as never,
    );

    const result = await controller.cancel({ ucMerchantId: 'm1' } as never, {
      orderId: 'UC-1',
      orderItems: [
        { orderItemId: 'item-1', productId: 'p1', variantId: 'v1', quantity: 1 },
        { orderItemId: 'unknown-item', productId: 'p2', variantId: 'v2', quantity: 1 },
      ],
    });

    expect(ratio.cancelOrder).toHaveBeenCalledTimes(1);
    expect(ratio.cancelOrder).toHaveBeenCalledWith('m1', 'order-1');
    expect(result).toEqual({
      status: 'PARTIAL_SUCCESS',
      orderItems: [
        { orderItemId: 'item-1' },
        { orderItemId: 'unknown-item', errorMessage: 'unknown orderItemId' },
      ],
    });
  });

  // TRD §2.7: cancelling only SOME of an order's items must not cancel the
  // whole order — it must PATCH the order with the surviving line items.
  it('PATCHes surviving line items (not a whole-order cancel) when only some items of the order are being cancelled', async () => {
    const cancelledItem = fullItem({ orderItemId: 'item-1', ratioLineItemId: 'line-1' });
    const survivingItem = fullItem({
      orderItemId: 'item-2',
      ratioLineItemId: 'line-2',
      remainingQuantity: 1,
    });
    const orderItemMap = {
      resolveFull: vi.fn().mockResolvedValue(cancelledItem),
      findByRatioOrder: vi.fn().mockResolvedValue([cancelledItem, survivingItem]),
      markSource: vi.fn().mockResolvedValue(undefined),
      decrementRemainingQuantity: vi.fn().mockResolvedValue(undefined),
      updateLastStatus: vi.fn().mockResolvedValue(undefined),
    };
    const ratio = {
      cancelOrder: vi.fn(),
      updateOrderLineItems: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new UcOrderCancelController(
      orderItemMap as never,
      ratio as never,
      { record: vi.fn() } as never,
      enabledFlags() as never,
    );

    const result = await controller.cancel({ ucMerchantId: 'm1' } as never, {
      orderId: 'UC-1',
      orderItems: [{ orderItemId: 'item-1', productId: 'p1', variantId: 'v1', quantity: 1 }],
    });

    expect(ratio.cancelOrder).not.toHaveBeenCalled();
    expect(ratio.updateOrderLineItems).toHaveBeenCalledWith('m1', 'order-1', [{ id: 'line-2' }]);
    expect(orderItemMap.markSource).toHaveBeenCalledWith('item-1', 'uc_originated');
    expect(orderItemMap.markSource).not.toHaveBeenCalledWith('item-2', expect.anything());
    expect(result).toEqual({ status: 'SUCCESS', orderItems: [{ orderItemId: 'item-1' }] });
  });

  // Fix 2: an event-log write failure must never turn this real success into
  // a rejected request handler — a false 500 here would risk a client retry
  // that re-runs the dedup logic and calls ratio.cancelOrder a second time.
  it('still returns the correct success response when eventLog.record() rejects (Fix 2)', async () => {
    const item1 = fullItem();
    const orderItemMap = {
      resolveFull: vi.fn().mockResolvedValue(item1),
      findByRatioOrder: vi.fn().mockResolvedValue([item1]),
      markSource: vi.fn().mockResolvedValue(undefined),
      decrementRemainingQuantity: vi.fn().mockResolvedValue(undefined),
      updateLastStatus: vi.fn().mockResolvedValue(undefined),
    };
    const ratio = {
      cancelOrder: vi.fn().mockResolvedValue(undefined),
      updateOrderLineItems: vi.fn(),
    };
    const eventLog = { record: vi.fn().mockRejectedValue(new Error('transient DB error')) };
    const controller = new UcOrderCancelController(
      orderItemMap as never,
      ratio as never,
      eventLog as never,
      enabledFlags() as never,
    );

    const result = await controller.cancel({ ucMerchantId: 'm1' } as never, {
      orderId: 'UC-1',
      orderItems: [{ orderItemId: 'item-1', productId: 'p1', variantId: 'v1', quantity: 1 }],
    });

    expect(ratio.cancelOrder).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'SUCCESS', orderItems: [{ orderItemId: 'item-1' }] });
  });

  // TRD §6: cancel_sync flag off → accept-and-no-op, never hard-reject.
  it('returns a no-op SUCCESS without touching the order-item map or Ratio when cancel_sync is disabled', async () => {
    const orderItemMap = { resolveFull: vi.fn() };
    const ratio = { cancelOrder: vi.fn(), updateOrderLineItems: vi.fn() };
    const flags = { isEnabled: vi.fn().mockResolvedValue(false) };
    const controller = new UcOrderCancelController(
      orderItemMap as never,
      ratio as never,
      { record: vi.fn() } as never,
      flags as never,
    );

    const result = await controller.cancel({ ucMerchantId: 'm1' } as never, {
      orderId: 'UC-1',
      orderItems: [{ orderItemId: 'item-1', productId: 'p1', variantId: 'v1', quantity: 1 }],
    });

    expect(flags.isEnabled).toHaveBeenCalledWith('cancel_sync', 'm1');
    expect(orderItemMap.resolveFull).not.toHaveBeenCalled();
    expect(ratio.cancelOrder).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'SUCCESS', orderItems: [{ orderItemId: 'item-1' }] });
  });

  // Found via local verification: a downstream Ratio-call failure (network
  // error, expired OAuth token, Ratio 5xx) must degrade to a per-item error
  // for every item in the affected order group, not an uncaught exception
  // crashing the whole batch with a raw 500.
  it('reports a downstream Ratio-call failure as a per-item error, not an uncaught exception', async () => {
    const item1 = fullItem();
    const orderItemMap = {
      resolveFull: vi.fn().mockResolvedValue(item1),
      findByRatioOrder: vi.fn().mockResolvedValue([item1]),
      markSource: vi.fn(),
      decrementRemainingQuantity: vi.fn(),
      updateLastStatus: vi.fn(),
    };
    const ratio = {
      cancelOrder: vi
        .fn()
        .mockRejectedValue(new Error('no Ratio oauth_tokens row for merchant m1')),
      updateOrderLineItems: vi.fn(),
    };
    const controller = new UcOrderCancelController(
      orderItemMap as never,
      ratio as never,
      { record: vi.fn() } as never,
      enabledFlags() as never,
    );

    const result = await controller.cancel({ ucMerchantId: 'm1' } as never, {
      orderId: 'UC-1',
      orderItems: [{ orderItemId: 'item-1', productId: 'p1', variantId: 'v1', quantity: 1 }],
    });

    expect(orderItemMap.markSource).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'FAILED',
      orderItems: [{ orderItemId: 'item-1', errorMessage: 'failed to apply update' }],
    });
  });
});
