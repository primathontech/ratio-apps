import { describe, expect, it, vi } from 'vitest';
import { UcStatusController } from '../../../../src/modules/unicommerce/controllers/status.controller';

function enabledFlags() {
  return { isEnabled: vi.fn().mockResolvedValue(true) };
}

describe('UcStatusController.notify', () => {
  it('resolves each orderItemId, maps status, and updates the matching Ratio order', async () => {
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
      updateLastStatus: vi.fn().mockResolvedValue(undefined),
    };
    const statusMapping = { map: vi.fn().mockReturnValue('fulfilled') };
    const ratio = { updateOrderStatus: vi.fn().mockResolvedValue(undefined) };
    const controller = new UcStatusController(
      orderItemMap as never,
      statusMapping as never,
      ratio as never,
      { record: vi.fn() } as never,
      { touchStatusNotification: vi.fn().mockResolvedValue(undefined) } as never,
      enabledFlags() as never,
    );

    const result = await controller.notify('UC-1', { ucMerchantId: 'm1' } as never, {
      orderItems: [
        {
          orderItemId: 'item-1',
          status: 'DISPATCHED',
          IsReverse: false,
          updated: '2026-07-20T00:00:00Z',
        },
      ],
    });

    expect(statusMapping.map).toHaveBeenCalledWith('DISPATCHED', false);
    expect(ratio.updateOrderStatus).toHaveBeenCalledWith('m1', 'order-1', 'fulfilled');
    expect(result).toEqual({ status: 'SUCCESS', orderItems: [{ orderItemId: 'item-1' }] });
  });

  it('skips calling updateOrderStatus when the mapped status is no_change', async () => {
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
      updateLastStatus: vi.fn().mockResolvedValue(undefined),
    };
    const statusMapping = { map: vi.fn().mockReturnValue('no_change') };
    const ratio = { updateOrderStatus: vi.fn() };
    const controller = new UcStatusController(
      orderItemMap as never,
      statusMapping as never,
      ratio as never,
      { record: vi.fn() } as never,
      { touchStatusNotification: vi.fn().mockResolvedValue(undefined) } as never,
      enabledFlags() as never,
    );

    const result = await controller.notify('UC-1', { ucMerchantId: 'm1' } as never, {
      orderItems: [
        {
          orderItemId: 'item-1',
          status: 'PICKING',
          IsReverse: false,
          updated: '2026-07-20T00:00:00Z',
        },
      ],
    });

    expect(ratio.updateOrderStatus).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'SUCCESS', orderItems: [{ orderItemId: 'item-1' }] });
  });

  it('reports an unresolvable orderItemId as a per-item error, not a thrown exception', async () => {
    const orderItemMap = { resolveFull: vi.fn().mockResolvedValue(null) };
    const statusMapping = { map: vi.fn() };
    const ratio = { updateOrderStatus: vi.fn() };
    const controller = new UcStatusController(
      orderItemMap as never,
      statusMapping as never,
      ratio as never,
      { record: vi.fn() } as never,
      { touchStatusNotification: vi.fn().mockResolvedValue(undefined) } as never,
      enabledFlags() as never,
    );

    const result = await controller.notify('UC-1', { ucMerchantId: 'm1' } as never, {
      orderItems: [
        {
          orderItemId: 'unknown-item',
          status: 'DISPATCHED',
          IsReverse: false,
          updated: '2026-07-20T00:00:00Z',
        },
      ],
    });

    expect(statusMapping.map).not.toHaveBeenCalled();
    expect(ratio.updateOrderStatus).not.toHaveBeenCalled();
    // Confirmed by UC's team: this endpoint must ALWAYS return SUCCESS at
    // the top level, regardless of internal outcome — anything else means
    // UC stops sending further status notifications for this order entirely
    // until the merchant manually retries inside Unicommerce. The real
    // failure is still visible in the per-item errorMessage.
    expect(result).toEqual({
      status: 'SUCCESS',
      orderItems: [{ orderItemId: 'unknown-item', errorMessage: 'unknown orderItemId' }],
    });
  });

  it('treats a mapping that belongs to a different merchant as unknown, without calling updateOrderStatus', async () => {
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
    const statusMapping = { map: vi.fn() };
    const ratio = { updateOrderStatus: vi.fn() };
    const controller = new UcStatusController(
      orderItemMap as never,
      statusMapping as never,
      ratio as never,
      { record: vi.fn() } as never,
      { touchStatusNotification: vi.fn().mockResolvedValue(undefined) } as never,
      enabledFlags() as never,
    );

    const result = await controller.notify('UC-1', { ucMerchantId: 'm1' } as never, {
      orderItems: [
        {
          orderItemId: 'foreign-item',
          status: 'DISPATCHED',
          IsReverse: false,
          updated: '2026-07-20T00:00:00Z',
        },
      ],
    });

    expect(statusMapping.map).not.toHaveBeenCalled();
    expect(ratio.updateOrderStatus).not.toHaveBeenCalled();
    // Confirmed by UC's team: this endpoint must ALWAYS return SUCCESS at
    // the top level — see the other "unknown orderItemId" test above for
    // the full reasoning.
    expect(result).toEqual({
      status: 'SUCCESS',
      orderItems: [{ orderItemId: 'foreign-item', errorMessage: 'unknown orderItemId' }],
    });
  });

  it('reports SUCCESS when at least one item resolves and others fail', async () => {
    const orderItemMap = {
      resolveFull: vi.fn().mockImplementation((orderItemId: string) =>
        orderItemId === 'item-1'
          ? Promise.resolve({
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
            })
          : Promise.resolve(null),
      ),
      updateLastStatus: vi.fn().mockResolvedValue(undefined),
    };
    const statusMapping = { map: vi.fn().mockReturnValue('delivered') };
    const ratio = { updateOrderStatus: vi.fn().mockResolvedValue(undefined) };
    const controller = new UcStatusController(
      orderItemMap as never,
      statusMapping as never,
      ratio as never,
      { record: vi.fn() } as never,
      { touchStatusNotification: vi.fn().mockResolvedValue(undefined) } as never,
      enabledFlags() as never,
    );

    const result = await controller.notify('UC-1', { ucMerchantId: 'm1' } as never, {
      orderItems: [
        {
          orderItemId: 'item-1',
          status: 'DELIVERED',
          IsReverse: false,
          updated: '2026-07-20T00:00:00Z',
        },
        {
          orderItemId: 'unknown-item',
          status: 'DELIVERED',
          IsReverse: false,
          updated: '2026-07-20T00:00:00Z',
        },
      ],
    });

    expect(ratio.updateOrderStatus).toHaveBeenCalledTimes(1);
    expect(ratio.updateOrderStatus).toHaveBeenCalledWith('m1', 'order-1', 'delivered');
    expect(result).toEqual({
      status: 'SUCCESS',
      orderItems: [
        { orderItemId: 'item-1' },
        { orderItemId: 'unknown-item', errorMessage: 'unknown orderItemId' },
      ],
    });
  });

  // Fix 3: UcStatusMappingService.map() deliberately throws on any
  // unrecognized status. A single unmapped status anywhere in the batch must
  // degrade to a per-item error, not abort the whole request with an
  // unhandled exception — and other items in the same batch must still be
  // processed normally.
  it('reports an unrecognized status as a per-item error, not a thrown exception, and still processes the rest of the batch (Fix 3)', async () => {
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
      updateLastStatus: vi.fn().mockResolvedValue(undefined),
    };
    const statusMapping = {
      map: vi.fn().mockImplementation((status: string) => {
        if (status === 'SOME_UNKNOWN_STATUS') {
          throw new Error('unrecognized Unicommerce status: SOME_UNKNOWN_STATUS (forward)');
        }
        return 'delivered';
      }),
    };
    const ratio = { updateOrderStatus: vi.fn().mockResolvedValue(undefined) };
    const controller = new UcStatusController(
      orderItemMap as never,
      statusMapping as never,
      ratio as never,
      { record: vi.fn() } as never,
      { touchStatusNotification: vi.fn().mockResolvedValue(undefined) } as never,
      enabledFlags() as never,
    );

    const result = await controller.notify('UC-1', { ucMerchantId: 'm1' } as never, {
      orderItems: [
        {
          orderItemId: 'item-1',
          status: 'SOME_UNKNOWN_STATUS',
          IsReverse: false,
          updated: '2026-07-20T00:00:00Z',
        },
        {
          orderItemId: 'item-2',
          status: 'DELIVERED',
          IsReverse: false,
          updated: '2026-07-20T00:00:00Z',
        },
      ],
    });

    expect(ratio.updateOrderStatus).toHaveBeenCalledTimes(1);
    expect(ratio.updateOrderStatus).toHaveBeenCalledWith('m1', 'order-1', 'delivered');
    expect(result).toEqual({
      status: 'SUCCESS',
      orderItems: [
        { orderItemId: 'item-1', errorMessage: 'unrecognized status' },
        { orderItemId: 'item-2' },
      ],
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
      updateLastStatus: vi.fn().mockResolvedValue(undefined),
    };
    const statusMapping = { map: vi.fn().mockReturnValue('fulfilled') };
    const ratio = { updateOrderStatus: vi.fn().mockResolvedValue(undefined) };
    const eventLog = { record: vi.fn().mockRejectedValue(new Error('transient DB error')) };
    const controller = new UcStatusController(
      orderItemMap as never,
      statusMapping as never,
      ratio as never,
      eventLog as never,
      { touchStatusNotification: vi.fn().mockResolvedValue(undefined) } as never,
      enabledFlags() as never,
    );

    const result = await controller.notify('UC-1', { ucMerchantId: 'm1' } as never, {
      orderItems: [
        {
          orderItemId: 'item-1',
          status: 'DISPATCHED',
          IsReverse: false,
          updated: '2026-07-20T00:00:00Z',
        },
      ],
    });

    expect(result).toEqual({ status: 'SUCCESS', orderItems: [{ orderItemId: 'item-1' }] });
  });

  // TRD §6: dispatch_status_sync flag off → accept-and-no-op, never
  // hard-reject — but the notification-received signal (§5 Signal B
  // proof-of-life) must still be recorded even though nothing else runs.
  it('returns a no-op SUCCESS and still touches the status-notification timestamp when dispatch_status_sync is disabled', async () => {
    const orderItemMap = { resolveFull: vi.fn() };
    const statusMapping = { map: vi.fn() };
    const ratio = { updateOrderStatus: vi.fn() };
    const credentials = { touchStatusNotification: vi.fn().mockResolvedValue(undefined) };
    const flags = { isEnabled: vi.fn().mockResolvedValue(false) };
    const controller = new UcStatusController(
      orderItemMap as never,
      statusMapping as never,
      ratio as never,
      { record: vi.fn() } as never,
      credentials as never,
      flags as never,
    );

    const result = await controller.notify('UC-1', { ucMerchantId: 'm1' } as never, {
      orderItems: [
        {
          orderItemId: 'item-1',
          status: 'DISPATCHED',
          IsReverse: false,
          updated: '2026-07-20T00:00:00Z',
        },
      ],
    });

    expect(flags.isEnabled).toHaveBeenCalledWith('dispatch_status_sync', 'm1');
    expect(orderItemMap.resolveFull).not.toHaveBeenCalled();
    expect(ratio.updateOrderStatus).not.toHaveBeenCalled();
    expect(credentials.touchStatusNotification).toHaveBeenCalledWith('m1');
    expect(result).toEqual({ status: 'SUCCESS', orderItems: [{ orderItemId: 'item-1' }] });
  });

  // Found via local verification: a downstream Ratio-call failure (network
  // error, expired OAuth token, Ratio 5xx) must never escape as an uncaught
  // exception — this endpoint's top-level status is contractually always
  // SUCCESS (see the other tests above), so a raw 500 here would violate
  // that guarantee just as badly as returning FAILED would.
  it('reports a downstream Ratio-call failure as a per-item error, not an uncaught exception, and still returns SUCCESS overall', async () => {
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
      updateLastStatus: vi.fn().mockResolvedValue(undefined),
    };
    const statusMapping = { map: vi.fn().mockReturnValue('fulfilled') };
    const ratio = {
      updateOrderStatus: vi
        .fn()
        .mockRejectedValue(new Error('no Ratio oauth_tokens row for merchant m1')),
    };
    const controller = new UcStatusController(
      orderItemMap as never,
      statusMapping as never,
      ratio as never,
      { record: vi.fn() } as never,
      { touchStatusNotification: vi.fn().mockResolvedValue(undefined) } as never,
      enabledFlags() as never,
    );

    const result = await controller.notify('UC-1', { ucMerchantId: 'm1' } as never, {
      orderItems: [
        {
          orderItemId: 'item-1',
          status: 'DISPATCHED',
          IsReverse: false,
          updated: '2026-07-20T00:00:00Z',
        },
      ],
    });

    expect(orderItemMap.updateLastStatus).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'SUCCESS',
      orderItems: [{ orderItemId: 'item-1', errorMessage: 'failed to apply update' }],
    });
  });
});
