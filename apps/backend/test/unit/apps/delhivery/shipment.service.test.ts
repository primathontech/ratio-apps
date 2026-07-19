import { beforeEach, describe, expect, it, vi } from 'vitest';

// `sql` is only used for CURRENT_TIMESTAMP column values in updates — stub it
// so the service runs against a plain fake handle.
vi.mock('kysely', () => ({
  sql: (..._args: unknown[]) => ({ execute: vi.fn().mockResolvedValue(undefined) }),
}));

import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import type { DelhiveryConfigService } from '../../../../src/modules/delhivery/config/config.service';
import type { DelhiveryDatabase, DelhiveryShipmentRow } from '../../../../src/modules/delhivery/db/types';
import type { RatioOrdersPort } from '../../../../src/modules/delhivery/ratio/ratio-orders.service';
import type { DelhiverySdkService } from '../../../../src/modules/delhivery/sdk/sdk.service';
import { DelhiveryShipmentService } from '../../../../src/modules/delhivery/shipments/shipment.service';

const baseConfig = {
  apiToken: 'tok',
  pickupLocationName: 'WH',
  gstin: 'GSTIN1',
  pickupCutoff: '10:00',
  awbTrigger: 'auto' as const,
  defaultBox: { l: 10, b: 10, h: 10 },
  enabled: true,
};

const paidOrder = {
  id: 'ord_1',
  order_number: '1001',
  source: 'Online Store',
  payment_method: 'COD',
  total_price: 149900, // paise → ₹1499
  phone: '9999999999',
  shipping_address: {
    name: 'Asha K',
    address1: '1 MG Road',
    zip: '560001',
    city: 'Bengaluru',
    province: 'KA',
    country: 'India',
    phone: '9999999999',
  },
  line_items: [{ product_id: 'p1', quantity: 2, grams: 250, title: 'Tee' }],
};

const product = {
  id: 'p1',
  title: 'Tee',
  grams: 250,
  hs_code: '6109',
  metafields: [
    { key: 'length_cm', value: 30 },
    { key: 'breadth_cm', value: 20 },
    { key: 'height_cm', value: 4 },
  ],
};

function fakeHandle(init: { shipmentRow?: DelhiveryShipmentRow } = {}) {
  const holder: { row?: DelhiveryShipmentRow } = { row: init.shipmentRow };
  const recorder: {
    inserted?: Record<string, unknown>;
    updates: Record<string, unknown>[];
    selectWheres: unknown[][];
  } = { updates: [], selectWheres: [] };

  const selectChain = {
    selectAll: () => selectChain,
    select: () => selectChain,
    where: (...args: unknown[]) => {
      recorder.selectWheres.push(args);
      return selectChain;
    },
    limit: () => selectChain,
    orderBy: () => selectChain,
    offset: () => selectChain,
    executeTakeFirst: async () => holder.row,
    execute: async () => (holder.row ? [holder.row] : []),
  };
  const insertChain = {
    values: (v: Record<string, unknown>) => {
      recorder.inserted = v;
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
  return { handle: { db } as unknown as KyselyClient<DelhiveryDatabase>, holder, recorder };
}

function makeService(opts: {
  config?: typeof baseConfig;
  shipmentRow?: DelhiveryShipmentRow;
  order?: Record<string, unknown> | null;
  createShipment?: unknown;
  pendingOrders?: Record<string, unknown>[];
} = {}) {
  const { handle, holder, recorder } = fakeHandle(
    opts.shipmentRow !== undefined ? { shipmentRow: opts.shipmentRow } : {},
  );
  const configs = {
    getByMerchantId: vi.fn(async () => opts.config ?? baseConfig),
  } as unknown as DelhiveryConfigService;
  const sdk = {
    createShipment: opts.createShipment ?? vi.fn(async () => ({ awb: 'AWB123456' })),
    cancelShipment: vi.fn(async () => undefined),
  } as unknown as DelhiverySdkService;
  const orders = {
    getOrder: vi.fn(async () => (opts.order === undefined ? paidOrder : opts.order)),
    listOrders: vi.fn(async () => opts.pendingOrders ?? []),
    getProduct: vi.fn(async () => product),
    patchOrder: vi.fn(async () => undefined),
    setExternalOrderId: vi.fn(async () => undefined),
    incrementStock: vi.fn(async () => undefined),
    createRefund: vi.fn(async () => undefined),
  } as unknown as RatioOrdersPort;
  const service = new DelhiveryShipmentService(handle, configs, sdk, orders);
  return { service, sdk, orders, holder, recorder };
}

const existingActive: DelhiveryShipmentRow = {
  id: 'shp_1',
  merchantId: 'mer_1',
  orderId: 'ord_1',
  orderNumber: '1001',
  awb: 'AWB-OLD',
  carrier: 'DELHIVERY',
  status: 'awaiting_pickup',
  paymentMode: 'COD',
  codAmount: 1499,
  weightGrams: 500,
  labelUrl: null,
  estimatedDelivery: null,
  active: true,
  pickupRequestedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('DelhiveryShipmentService.createForOrder', () => {
  beforeEach(() => vi.clearAllMocks());

  it('worker.paid.createsAwb + persistsShipment — manifests and writes the row', async () => {
    const { service, sdk, recorder } = makeService();
    const row = await service.createForOrder('mer_1', { orderId: 'ord_1' });

    expect(sdk.createShipment).toHaveBeenCalledWith(
      'mer_1',
      expect.objectContaining({
        orderNumber: '1001',
        paymentMode: 'COD',
        codAmount: 1499,
        weightGrams: 500,
        dims: { l: 30, b: 20, h: 4 },
        hsnCode: '6109',
      }),
    );
    expect(recorder.inserted).toMatchObject({
      merchantId: 'mer_1',
      orderId: 'ord_1',
      orderNumber: '1001',
      awb: 'AWB123456',
      status: 'awaiting_pickup',
      paymentMode: 'COD',
      codAmount: 1499,
    });
    expect(row?.awb).toBe('AWB123456');
  });

  it('worker.paid.mirrorsToOrder — PATCHes fulfillment_status + tracking and sets the external id', async () => {
    const { service, orders } = makeService();
    await service.createForOrder('mer_1', { orderId: 'ord_1' });

    expect(orders.patchOrder).toHaveBeenCalledWith('mer_1', 'ord_1', {
      fulfillment_status: 'awaiting_pickup',
      tracking_number: 'AWB123456',
      carrier: 'DELHIVERY',
    });
    expect(orders.setExternalOrderId).toHaveBeenCalledWith('mer_1', 'ord_1', 'AWB123456');
  });

  it('worker.paid.idempotent — duplicate order_number never mints a 2nd AWB (re-mirrors instead)', async () => {
    const { service, sdk, orders, recorder } = makeService({ shipmentRow: existingActive });
    const row = await service.createForOrder('mer_1', { orderId: 'ord_1' });

    expect(sdk.createShipment).not.toHaveBeenCalled();
    expect(recorder.inserted).toBeUndefined();
    expect(orders.patchOrder).toHaveBeenCalled(); // retry heals a failed mirror
    expect(row?.awb).toBe('AWB-OLD');
  });

  it('worker.paid.manualModeSkips — awb_trigger=manual skips the auto path', async () => {
    const { service, sdk, orders } = makeService({
      config: { ...baseConfig, awbTrigger: 'manual' },
    });
    const row = await service.createForOrder('mer_1', { orderId: 'ord_1' });

    expect(row).toBeNull();
    expect(sdk.createShipment).not.toHaveBeenCalled();
    expect(orders.getOrder).not.toHaveBeenCalled();
  });

  it('shipments.manualCreate — manual mode + explicit manual create still manifests', async () => {
    const { service, sdk } = makeService({ config: { ...baseConfig, awbTrigger: 'manual' } });
    const row = await service.createForOrder('mer_1', { orderId: 'ord_1' }, { manual: true });

    expect(sdk.createShipment).toHaveBeenCalled();
    expect(row?.awb).toBe('AWB123456');
  });

  it('disabled config is a hard skip', async () => {
    const { service, sdk } = makeService({ config: { ...baseConfig, enabled: false } });
    expect(await service.createForOrder('mer_1', { orderId: 'ord_1' })).toBeNull();
    expect(sdk.createShipment).not.toHaveBeenCalled();
  });

  it('worker.paid.retriesOn5xx — a Delhivery failure propagates (queue redelivers)', async () => {
    const { service } = makeService({
      createShipment: vi.fn(async () => {
        throw new Error('delhivery responded 502');
      }),
    });
    await expect(service.createForOrder('mer_1', { orderId: 'ord_1' })).rejects.toThrow('502');
  });
});

describe('DelhiveryShipmentService.cancelForOrder (webhook.cancelledCancelsAwb)', () => {
  it('cancels the AWB pre-pickup and marks the row shipment_cancelled', async () => {
    const { service, sdk, orders, recorder } = makeService({ shipmentRow: existingActive });
    const row = await service.cancelForOrder('mer_1', { orderId: 'ord_1', orderNumber: '1001' });

    expect(sdk.cancelShipment).toHaveBeenCalledWith('mer_1', 'AWB-OLD');
    expect(recorder.updates[0]).toMatchObject({ status: 'shipment_cancelled', active: false });
    expect(orders.patchOrder).toHaveBeenCalledWith(
      'mer_1',
      'ord_1',
      expect.objectContaining({ fulfillment_status: 'shipment_cancelled' }),
    );
    expect(row?.status).toBe('shipment_cancelled');
  });

  it('post-pickup: marks cancelled without calling Delhivery cancel', async () => {
    const { service, sdk, recorder } = makeService({
      shipmentRow: { ...existingActive, status: 'in_transit' },
    });
    await service.cancelForOrder('mer_1', { orderId: 'ord_1', orderNumber: '1001' });

    expect(sdk.cancelShipment).not.toHaveBeenCalled();
    expect(recorder.updates[0]).toMatchObject({ status: 'shipment_cancelled' });
  });

  it('no shipment → no-op', async () => {
    const { service, sdk } = makeService();
    expect(await service.cancelForOrder('mer_1', { orderId: 'ord_x', orderNumber: '9' })).toBeNull();
    expect(sdk.cancelShipment).not.toHaveBeenCalled();
  });
});

describe('DelhiveryShipmentService.listPendingOrders', () => {
  const alreadyShipped = {
    // orderId differs from order_number so the exclusion is pinned to orderNumber.
    id: 'ord_shipped',
    order_number: '1001',
    total_price: 199900,
    customer: { first_name: 'Ravi', last_name: 'Shipped' },
    shipping_address: { city: 'Pune' },
    created_at: '2026-07-01T00:00:00.000Z',
  };
  const awaiting = {
    id: 'ord_2',
    order_number: '2002',
    total_price: 149900, // paise → ₹1499
    customer: { first_name: 'Asha', last_name: 'K' },
    shipping_address: { city: 'Bengaluru' },
    created_at: '2026-07-02T00:00:00.000Z',
  };

  it('excludes already-shipped orders and maps the lean paise→rupees shape', async () => {
    // holder.row = existingActive (order_number 1001) → the batch SELECT returns it.
    const { service, orders, recorder } = makeService({
      shipmentRow: existingActive,
      pendingOrders: [alreadyShipped, awaiting],
    });
    const items = await service.listPendingOrders('mer_1');

    expect(orders.listOrders).toHaveBeenCalledWith('mer_1', {
      financialStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
    });
    // The batch SELECT is scoped to the merchant, the exact order numbers, and
    // only live shipments — a cancelled row must not exclude its order.
    expect(recorder.selectWheres).toEqual([
      ['merchantId', '=', 'mer_1'],
      ['orderNumber', 'in', ['1001', '2002']],
      ['active', '=', true],
    ]);
    expect(items).toEqual([
      {
        orderId: 'ord_2',
        orderNumber: '2002',
        customerName: 'Asha K',
        amountRupees: 1499,
        city: 'Bengaluru',
        createdAt: '2026-07-02T00:00:00.000Z',
      },
    ]);
  });

  it('falls back to the shipping-address name when the customer name is empty', async () => {
    const { service } = makeService({
      pendingOrders: [
        {
          id: 'ord_3',
          order_number: '3003',
          total_price: 50000,
          customer: {},
          shipping_address: { name: 'Meera P', city: 'Chennai' },
          created_at: '2026-07-03T00:00:00.000Z',
        },
      ],
    });
    const items = await service.listPendingOrders('mer_1');

    expect(items[0].customerName).toBe('Meera P');
  });
});
