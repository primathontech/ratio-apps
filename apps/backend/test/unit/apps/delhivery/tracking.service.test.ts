import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('kysely', () => ({
  sql: (..._args: unknown[]) => ({ execute: vi.fn().mockResolvedValue(undefined) }),
}));

import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import type { DelhiveryDatabase, DelhiveryShipmentRow } from '../../../../src/modules/delhivery/db/types';
import type { KwikEngagePort } from '../../../../src/modules/delhivery/events/kwikengage.client';
import type { RatioOrdersPort } from '../../../../src/modules/delhivery/ratio/ratio-orders.service';
import {
  DelhiveryTrackingService,
  mapDelhiveryStatus,
} from '../../../../src/modules/delhivery/tracking/tracking.service';

const shipment: DelhiveryShipmentRow = {
  id: 'shp_1',
  merchantId: 'mer_1',
  orderId: 'ord_1',
  orderNumber: '1001',
  awb: 'AWB123456',
  carrier: 'DELHIVERY',
  status: 'awaiting_pickup',
  paymentMode: 'Prepaid',
  codAmount: 0,
  weightGrams: 500,
  labelUrl: null,
  estimatedDelivery: null,
  active: true,
  pickupRequestedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function fakeHandle(init: { seenEvent?: boolean } = {}) {
  const recorder: { insertedEvent?: Record<string, unknown>; updates: Record<string, unknown>[] } = {
    updates: [],
  };
  const selectChain = {
    select: () => selectChain,
    where: () => selectChain,
    limit: () => selectChain,
    executeTakeFirst: async () => (init.seenEvent ? { id: 'evt_seen' } : undefined),
  };
  const insertChain = {
    values: (v: Record<string, unknown>) => {
      recorder.insertedEvent = v;
      return insertChain;
    },
    execute: async () => [],
  };
  const updateChain = {
    set: (p: Record<string, unknown>) => {
      recorder.updates.push(p);
      return updateChain;
    },
    where: () => updateChain,
    execute: async () => [],
  };
  const db = {
    selectFrom: () => selectChain,
    insertInto: () => insertChain,
    updateTable: () => updateChain,
  };
  return { handle: { db } as unknown as KyselyClient<DelhiveryDatabase>, recorder };
}

function makeService(opts: { seenEvent?: boolean; order?: Record<string, unknown> | null } = {}) {
  const { handle, recorder } = fakeHandle(opts.seenEvent !== undefined ? { seenEvent: opts.seenEvent } : {});
  const orders = {
    getOrder: vi.fn(async () =>
      opts.order === undefined
        ? { id: 'ord_1', line_items: [{ product_id: 'p1', variant_id: 'v1', quantity: 2 }] }
        : opts.order,
    ),
    getProduct: vi.fn(async () => null),
    patchOrder: vi.fn(async () => undefined),
    setExternalOrderId: vi.fn(async () => undefined),
    incrementStock: vi.fn(async () => undefined),
    createRefund: vi.fn(async () => undefined),
  } as unknown as RatioOrdersPort;
  const kwikengage = { sendShippingEvent: vi.fn(async () => undefined) } as unknown as KwikEngagePort;
  const service = new DelhiveryTrackingService(handle, orders, kwikengage);
  return { service, orders, kwikengage, recorder };
}

const scan = (statusType: string, status: string) => ({
  statusType,
  status,
  location: 'BLR Hub',
  timestamp: '2026-07-01T10:00:00',
});

describe('mapDelhiveryStatus (tracking.mapStatus.*)', () => {
  it('manifested → awaiting_pickup', () => {
    expect(mapDelhiveryStatus({ statusType: 'UD', status: 'Manifested' })).toBe('awaiting_pickup');
  });
  it('inTransit → in_transit', () => {
    expect(mapDelhiveryStatus({ statusType: 'UD', status: 'In Transit' })).toBe('in_transit');
  });
  it('ofd → out_for_delivery', () => {
    expect(mapDelhiveryStatus({ statusType: 'UD', status: 'Dispatched' })).toBe('out_for_delivery');
    expect(mapDelhiveryStatus({ statusType: 'UD', status: 'Out for delivery' })).toBe('out_for_delivery');
  });
  it('delivered → delivered', () => {
    expect(mapDelhiveryStatus({ statusType: 'DL', status: 'Delivered' })).toBe('delivered');
  });
  it('ud (NDR / attempt failed) → delivery_failed', () => {
    expect(mapDelhiveryStatus({ statusType: 'UD', status: 'Pending' })).toBe('delivery_failed');
    expect(mapDelhiveryStatus({ statusType: 'UD', status: 'Undelivered - consignee unavailable' })).toBe(
      'delivery_failed',
    );
  });
  it('rt → rto_completed', () => {
    expect(mapDelhiveryStatus({ statusType: 'RT', status: 'RTO Delivered' })).toBe('rto_completed');
    expect(mapDelhiveryStatus({ statusType: 'DL', status: 'RTO Delivered' })).toBe('rto_completed');
  });
  it('cn → shipment_cancelled', () => {
    expect(mapDelhiveryStatus({ statusType: 'CN', status: 'Cancelled' })).toBe('shipment_cancelled');
  });
});

describe('DelhiveryTrackingService.applyScan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists the event, updates the shipment, and mirrors the order', async () => {
    const { service, orders, recorder } = makeService();
    const applied = await service.applyScan(shipment, scan('UD', 'In Transit'));

    expect(applied).toBe('in_transit');
    expect(recorder.insertedEvent).toMatchObject({
      awb: 'AWB123456',
      rawStatus: 'In Transit',
      unifiedStatus: 'in_transit',
    });
    expect(recorder.updates[0]).toMatchObject({ status: 'in_transit' });
    expect(orders.patchOrder).toHaveBeenCalledWith('mer_1', 'ord_1', {
      fulfillment_status: 'in_transit',
      tracking_number: 'AWB123456',
      carrier: 'DELHIVERY',
    });
  });

  it('tracking.firesKwikEngageEvent — one app-side event per transition', async () => {
    const { service, kwikengage } = makeService();
    await service.applyScan(shipment, scan('UD', 'In Transit'));

    expect(kwikengage.sendShippingEvent).toHaveBeenCalledWith(
      'mer_1',
      'shipment_in_transit',
      expect.objectContaining({ awb: 'AWB123456', status: 'in_transit' }),
    );
  });

  it('tracking.dedupePerTransition — a seen (awb, unified_status) is a no-op', async () => {
    const { service, kwikengage, orders, recorder } = makeService({ seenEvent: true });
    const applied = await service.applyScan(shipment, scan('UD', 'In Transit'));

    expect(applied).toBeNull();
    expect(recorder.insertedEvent).toBeUndefined();
    expect(kwikengage.sendShippingEvent).not.toHaveBeenCalled();
    expect(orders.patchOrder).not.toHaveBeenCalled();
  });

  it('tracking.ndrStatusOnly — UD/NDR sets delivery_failed with NO resolution side effects', async () => {
    const { service, orders, recorder } = makeService();
    const applied = await service.applyScan(shipment, scan('UD', 'Undelivered - address issue'));

    expect(applied).toBe('delivery_failed');
    expect(recorder.updates[0]).toMatchObject({ status: 'delivery_failed' });
    expect(orders.incrementStock).not.toHaveBeenCalled();
    expect(orders.createRefund).not.toHaveBeenCalled();
  });

  it('tracking.rtoRestocks — RT restocks the order items via increment_stock', async () => {
    const { service, orders } = makeService();
    await service.applyScan(shipment, scan('RT', 'RTO Delivered'));

    expect(orders.incrementStock).toHaveBeenCalledWith('mer_1', [
      { productId: 'p1', variantId: 'v1', quantity: 2 },
    ]);
  });

  it('tracking.rtoRefundPrepaid — Prepaid RTO triggers a refund', async () => {
    const { service, orders } = makeService();
    await service.applyScan(shipment, scan('RT', 'RTO Delivered'));
    expect(orders.createRefund).toHaveBeenCalledWith('mer_1', 'ord_1');
  });

  it('COD RTO restocks but never refunds', async () => {
    const { service, orders } = makeService();
    await service.applyScan({ ...shipment, paymentMode: 'COD' }, scan('RT', 'RTO Delivered'));

    expect(orders.incrementStock).toHaveBeenCalled();
    expect(orders.createRefund).not.toHaveBeenCalled();
  });
});
