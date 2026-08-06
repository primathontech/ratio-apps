import { describe, expect, it, vi } from 'vitest';
import { UcOrdersReadController } from '../../../../src/modules/unicommerce/controllers/orders-read.controller';

describe('UcOrdersReadController', () => {
  it('lists confirmed orders with fixed pageSize=50, ignoring any caller-supplied override', async () => {
    const ratio = { listOrders: vi.fn().mockResolvedValue([]) };
    const controller = new UcOrdersReadController(ratio as never);

    await controller.list({ ucMerchantId: 'm1' } as never, '1', '9999');

    expect(ratio.listOrders).toHaveBeenCalledWith('m1', { page: 1, pageSize: 50 });
  });

  it('forwards orderStatus and orderDateFrom/orderDateTo to the service layer', async () => {
    const ratio = { listOrders: vi.fn().mockResolvedValue([]) };
    const controller = new UcOrdersReadController(ratio as never);

    await controller.list(
      { ucMerchantId: 'm1' } as never,
      '1',
      '9999',
      'CREATED',
      '2026-01-01T00:00:00+05:30',
      '2026-01-15T00:00:00+05:30',
    );

    expect(ratio.listOrders).toHaveBeenCalledWith('m1', {
      page: 1,
      pageSize: 50,
      orderStatus: 'CREATED',
      orderDateFrom: '2026-01-01T00:00:00+05:30',
      orderDateTo: '2026-01-15T00:00:00+05:30',
    });
  });

  // Confirmed routing bug fix: UC calls the SAME `GET /orders` path for the
  // status check, distinguished only by the `orderIds` query param — there
  // is no separate `/orders/status` path. The `orderIds` presence must route
  // internally to the status lookup, not fall through to the bulk list.
  it('routes to the status lookup (not the bulk list) when orderIds is present, ignoring bulk-pull params', async () => {
    const ratio = { listOrders: vi.fn(), getOrder: vi.fn().mockResolvedValue({ id: 'order-1', status: 'fulfilled' }) };
    const controller = new UcOrdersReadController(ratio as never);

    const result = await controller.list(
      { ucMerchantId: 'm1' } as never,
      '1',
      '9999',
      'CREATED',
      undefined,
      undefined,
      'order-1',
    );

    expect(ratio.listOrders).not.toHaveBeenCalled();
    expect(ratio.getOrder).toHaveBeenCalledWith('m1', 'order-1');
    expect(result).toEqual({ orders: [{ saleOrderCode: 'order-1', orderStatus: 'CREATED', id: 'order-1', status: 'fulfilled' }] });
  });

  // Confirmed by UC's team: orderIds accepts a comma-separated list.
  it('accepts a comma-separated orderIds list and looks up each one', async () => {
    const ratio = {
      listOrders: vi.fn(),
      getOrder: vi.fn().mockImplementation((_m: string, id: string) => Promise.resolve({ id, status: 'fulfilled' })),
    };
    const controller = new UcOrdersReadController(ratio as never);

    const result = await controller.list(
      { ucMerchantId: 'm1' } as never,
      '1',
      '9999',
      undefined,
      undefined,
      undefined,
      'order-1, order-2 ,order-3',
    );

    expect(ratio.getOrder).toHaveBeenCalledTimes(3);
    expect(ratio.getOrder).toHaveBeenNthCalledWith(1, 'm1', 'order-1');
    expect(ratio.getOrder).toHaveBeenNthCalledWith(2, 'm1', 'order-2');
    expect(ratio.getOrder).toHaveBeenNthCalledWith(3, 'm1', 'order-3');
    expect(result).toEqual({
      orders: [
        { saleOrderCode: 'order-1', orderStatus: 'CREATED', id: 'order-1', status: 'fulfilled' },
        { saleOrderCode: 'order-2', orderStatus: 'CREATED', id: 'order-2', status: 'fulfilled' },
        { saleOrderCode: 'order-3', orderStatus: 'CREATED', id: 'order-3', status: 'fulfilled' },
      ],
    });
  });

  it('drops any id that fails to resolve rather than failing the whole multi-id lookup', async () => {
    const ratio = {
      listOrders: vi.fn(),
      getOrder: vi.fn().mockImplementation((_m: string, id: string) =>
        id === 'missing' ? Promise.resolve(null) : Promise.resolve({ id, status: 'fulfilled' }),
      ),
    };
    const controller = new UcOrdersReadController(ratio as never);

    const result = await controller.list(
      { ucMerchantId: 'm1' } as never,
      '1',
      '9999',
      undefined,
      undefined,
      undefined,
      'order-1,missing',
    );

    expect(result).toEqual({ orders: [{ saleOrderCode: 'order-1', orderStatus: 'CREATED', id: 'order-1', status: 'fulfilled' }] });
  });

  // Found via local verification: a downstream Ratio-call failure must
  // degrade to a clean empty list, not an uncaught exception crashing the
  // whole bulk-pull request with a raw 500.
  it('bulk list returns {orders: []} instead of throwing when the Ratio call rejects', async () => {
    const ratio = { listOrders: vi.fn().mockRejectedValue(new Error('no Ratio oauth_tokens row for merchant m1')) };
    const controller = new UcOrdersReadController(ratio as never);

    const result = await controller.list({ ucMerchantId: 'm1' } as never, '1', '9999');

    expect(result).toEqual({ orders: [] });
  });

  it('single-id status lookup returns {orders: []} instead of throwing when the Ratio call rejects', async () => {
    const ratio = { listOrders: vi.fn(), getOrder: vi.fn().mockRejectedValue(new Error('no Ratio oauth_tokens row for merchant m1')) };
    const controller = new UcOrdersReadController(ratio as never);

    const result = await controller.list(
      { ucMerchantId: 'm1' } as never,
      '1',
      '9999',
      undefined,
      undefined,
      undefined,
      'order-1',
    );

    expect(result).toEqual({ orders: [] });
  });

  it('multi-id status lookup still returns the ones that resolved when one of the lookups rejects', async () => {
    const ratio = {
      listOrders: vi.fn(),
      getOrder: vi.fn().mockImplementation((_m: string, id: string) =>
        id === 'order-2' ? Promise.reject(new Error('transient Ratio 5xx')) : Promise.resolve({ id, status: 'fulfilled' }),
      ),
    };
    const controller = new UcOrdersReadController(ratio as never);

    const result = await controller.list(
      { ucMerchantId: 'm1' } as never,
      '1',
      '9999',
      undefined,
      undefined,
      undefined,
      'order-1,order-2,order-3',
    );

    expect(result).toEqual({
      orders: [
        { saleOrderCode: 'order-1', orderStatus: 'CREATED', id: 'order-1', status: 'fulfilled' },
        { saleOrderCode: 'order-3', orderStatus: 'CREATED', id: 'order-3', status: 'fulfilled' },
      ],
    });
  });
});
