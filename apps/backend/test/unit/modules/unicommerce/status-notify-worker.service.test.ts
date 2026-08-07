import { describe, expect, it, vi } from 'vitest';
import { UcStatusMappingService } from '../../../../src/modules/unicommerce/services/status-mapping.service';
import { UcStatusNotifyWorkerService } from '../../../../src/modules/unicommerce/services/status-notify-worker.service';

// Mirrors the hand-rolled-fake conventions of this module's tests: real
// UcStatusMappingService (pure, no IO) + vi.fn() fakes for the two IO
// services, exactly how sync-queue.service.test.ts wires its workers.
function setup(overrides: { full?: unknown; updateLastStatus?: () => Promise<void> } = {}) {
  const orderItemMap = {
    resolveFull: vi.fn().mockResolvedValue(
      // `overrides.full === undefined` (not `??`) so an explicit `full: null`
      // override really yields null instead of falling back to the default row.
      overrides.full === undefined
        ? {
            orderItemId: 'item-1',
            merchantId: 'm1',
            ratioOrderId: 'order-1',
            ratioLineItemId: 'li-1',
            orderedQuantity: 1,
            remainingQuantity: 1,
            lastStatus: null,
            lastStatusUpdatedAt: null,
            saleOrderCode: null,
            source: 'ratio_originated',
          }
        : overrides.full,
    ),
    updateLastStatus: vi.fn(overrides.updateLastStatus ?? (async () => undefined)),
  };
  const ratio = { updateOrderStatus: vi.fn().mockResolvedValue(undefined) };
  const worker = new UcStatusNotifyWorkerService(
    orderItemMap as never,
    new UcStatusMappingService(),
    ratio as never,
  );
  return { orderItemMap, ratio, worker };
}

describe('UcStatusNotifyWorkerService.apply', () => {
  it("rejects 'unknown orderItemId' when the item has no mapping row (same vocabulary as the sync endpoint)", async () => {
    const { orderItemMap, ratio, worker } = setup({ full: null });

    await expect(
      worker.apply('m1', { orderId: 'order-1', orderItemId: 'item-1', status: 'DISPATCHED', IsReverse: false, updated: '2026-08-06T14:05:00+05:30' }),
    ).rejects.toThrow('unknown orderItemId');
    expect(ratio.updateOrderStatus).not.toHaveBeenCalled();
    expect(orderItemMap.updateLastStatus).not.toHaveBeenCalled();
  });

  it("rejects 'unknown orderItemId' when the mapping belongs to a DIFFERENT merchant", async () => {
    const { ratio, worker } = setup({
      full: { merchantId: 'm2', ratioOrderId: 'order-other', lastStatus: null, lastStatusUpdatedAt: null },
    });

    await expect(
      worker.apply('m1', { orderId: 'order-1', orderItemId: 'item-1', status: 'DISPATCHED', IsReverse: false, updated: '2026-08-06T14:05:00+05:30' }),
    ).rejects.toThrow('unknown orderItemId');
    expect(ratio.updateOrderStatus).not.toHaveBeenCalled();
  });

  it("returns { applied: false, reason: 'no_change' } for a duplicate/out-of-order update (no Ratio write)", async () => {
    const { orderItemMap, ratio, worker } = setup({
      full: {
        merchantId: 'm1',
        ratioOrderId: 'order-1',
        lastStatus: 'DISPATCHED',
        lastStatusUpdatedAt: new Date('2026-08-06T15:00:00+05:30'),
      },
    });

    const result = await worker.apply('m1', {
      orderId: 'order-1',
      orderItemId: 'item-1',
      status: 'DISPATCHED',
      IsReverse: false,
      updated: '2026-08-06T14:05:00+05:30', // older than stored → duplicate
    });

    expect(result).toEqual({ applied: false, reason: 'no_change' });
    expect(ratio.updateOrderStatus).not.toHaveBeenCalled();
    expect(orderItemMap.updateLastStatus).not.toHaveBeenCalled();
  });

  it('rejects an unrecognized Unicommerce status (mirrors the sync endpoint\'s "unrecognized status" error)', async () => {
    const { ratio, worker } = setup();

    await expect(
      worker.apply('m1', { orderId: 'order-1', orderItemId: 'item-1', status: 'NONEXISTENT_STATUS', IsReverse: false, updated: '2026-08-06T14:05:00+05:30' }),
    ).rejects.toThrow(/unrecognized Unicommerce status/);
    expect(ratio.updateOrderStatus).not.toHaveBeenCalled();
  });

  it('maps the status, PATCHes Ratio, and records lastStatus on success', async () => {
    const { orderItemMap, ratio, worker } = setup();

    const result = await worker.apply('m1', {
      orderId: 'order-1',
      orderItemId: 'item-1',
      status: 'DISPATCHED',
      IsReverse: false,
      updated: '2026-08-06T14:05:00+05:30',
    });

    expect(ratio.updateOrderStatus).toHaveBeenCalledWith('m1', 'order-1', 'fulfilled');
    expect(orderItemMap.updateLastStatus).toHaveBeenCalledWith('item-1', 'DISPATCHED', '2026-08-06T14:05:00+05:30');
    expect(result).toEqual({ applied: true, mappedStatus: 'fulfilled' });
  });

  it("applies the reverse map when IsReverse is true (COMPLETE → 'restocked')", async () => {
    const { ratio, worker } = setup();

    await worker.apply('m1', {
      orderId: 'order-1',
      orderItemId: 'item-1',
      // COMPLETE lives in the REVERSE map (return flow end-state); RETURNED is
      // a FORWARD status ('returned') and would correctly be unrecognized when
      // IsReverse is true.
      status: 'COMPLETE',
      IsReverse: true,
      updated: '2026-08-06T14:05:00+05:30',
    });

    expect(ratio.updateOrderStatus).toHaveBeenCalledWith('m1', 'order-1', 'restocked');
  });

  it("a 'no_change' mapping (e.g. forward CREATED) skips the Ratio write but still records lastStatus — same as the sync endpoint", async () => {
    const { orderItemMap, ratio, worker } = setup();

    const result = await worker.apply('m1', {
      orderId: 'order-1',
      orderItemId: 'item-1',
      status: 'CREATED',
      IsReverse: false,
      updated: '2026-08-06T14:05:00+05:30',
    });

    expect(ratio.updateOrderStatus).not.toHaveBeenCalled();
    expect(orderItemMap.updateLastStatus).toHaveBeenCalledWith('item-1', 'CREATED', '2026-08-06T14:05:00+05:30');
    expect(result).toEqual({ applied: true, mappedStatus: 'no_change' });
  });
});
