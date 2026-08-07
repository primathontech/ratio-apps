import { describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { RatioClient } from '../../../../src/core/ratio-client/ratio.client';
import { UcRatioApiService } from '../../../../src/modules/unicommerce/services/uc-ratio-api.service';
import type { UcRatioTokenProvider } from '../../../../src/modules/unicommerce/oauth/ratio-token.provider';

/**
 * Fake token provider — yields a fixed access token for every merchant. Its
 * withAuthRetry is the minimal stand-in that preserves the OLD service behavior
 * (token resolved up front, then the request): it just delegates to
 * getAccessToken and runs `fn` once with that token.
 */
function fakeTokens(token = 'tok'): UcRatioTokenProvider {
  const getAccessToken = vi.fn(async () => token);
  const withAuthRetry = vi.fn(
    async (_merchantId: string, fn: (accessToken: string) => Promise<unknown>) =>
      fn(await getAccessToken(_merchantId)),
  );
  return { getAccessToken, withAuthRetry } as unknown as UcRatioTokenProvider;
}

/**
 * Fake token provider whose withAuthRetry simulates ONE real provider's retry:
 * runs `fn` with the initial token, and if it rejects with an upstream 401
 * (nested in details.status, the way RatioClient throws), re-runs it once with
 * a fresh token.
 */
function retryingTokens(initial = 'tok', fresh = 'tok-fresh'): UcRatioTokenProvider {
  const withAuthRetry = vi.fn(
    async (_merchantId: string, fn: (accessToken: string) => Promise<unknown>) => {
      try {
        return await fn(initial);
      } catch (err) {
        if (err instanceof HttpException) {
          const details = (err.getResponse() as Record<string, unknown>)?.details as
            | Record<string, unknown>
            | undefined;
          if (details?.status === 401) return fn(fresh);
        }
        throw err;
      }
    },
  );
  return { getAccessToken: vi.fn(async () => initial), withAuthRetry } as unknown as UcRatioTokenProvider;
}

/** A 401 the way RatioClient (core/ratio-client/ratio.client.ts) throws it. */
function upstream401(): HttpException {
  return new HttpException(
    { message: 'ratio upstream error', error_code: 'RATIO_UPSTREAM_ERROR', details: { status: 401 } },
    502,
  );
}

describe('UcRatioApiService.listProducts', () => {
  it('GETs /api/v1/v1/products (double-v1 is Ratio\'s real route for this resource, not a bug — see uc-ratio-api.service.ts) with offset/limit/show_variants/status params (not `page` — echoed but not applied server-side)', async () => {
    const request = vi.fn().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    const svc = new UcRatioApiService(fakeTokens('tok'), { request } as unknown as RatioClient);

    const products = await svc.listProducts('m1', { offset: 0, limit: 10 });

    expect(request).toHaveBeenCalledTimes(1);
    const [path, , options] = request.mock.calls[0] as [string, unknown, { accessToken: string }];
    expect(path).toContain('/api/v1/v1/products?');
    expect(path).toContain('offset=0');
    expect(path).toContain('limit=10');
    expect(path).toContain('show_variants=true');
    expect(path).toContain('status=active');
    expect(path).not.toContain('page=');
    expect(options.accessToken).toBe('tok');
    expect(products).toEqual([{ id: 'p1' }, { id: 'p2' }]);
  });

  it('extracts items from a `{ data: [...] }` envelope', async () => {
    const request = vi.fn().mockResolvedValue({ data: [{ id: 'p1' }] });
    const svc = new UcRatioApiService(fakeTokens(), { request } as unknown as RatioClient);

    const products = await svc.listProducts('m1', { offset: 0, limit: 10 });
    expect(products).toEqual([{ id: 'p1' }]);
  });

  it('extracts items from a `{ products: [...] }` envelope', async () => {
    const request = vi.fn().mockResolvedValue({ products: [{ id: 'p1' }, { id: 'p2' }] });
    const svc = new UcRatioApiService(fakeTokens(), { request } as unknown as RatioClient);

    const products = await svc.listProducts('m1', { offset: 0, limit: 10 });
    expect(products).toEqual([{ id: 'p1' }, { id: 'p2' }]);
  });

  it('walks `offset` in requestCap-sized (10) chunks to fill a larger requested `limit`, since the real API caps each response at 10 rows', async () => {
    const request = vi.fn(async (path: string) => {
      const url = new URL(`http://x${path}`);
      const offset = Number(url.searchParams.get('offset'));
      // Real API returns at most 10 items per call regardless of requested limit.
      return Array.from({ length: 10 }, (_, i) => ({ id: `p${offset + i}` }));
    });
    const svc = new UcRatioApiService(fakeTokens('tok'), { request } as unknown as RatioClient);

    const products = await svc.listProducts('m1', { offset: 0, limit: 50 });

    // 50 requested at cap-10 per call => 5 calls, offsets 0,10,20,30,40.
    expect(request).toHaveBeenCalledTimes(5);
    const offsetsUsed = request.mock.calls.map(([path]: [string]) => {
      const url = new URL(`http://x${path}`);
      return url.searchParams.get('offset');
    });
    expect(offsetsUsed).toEqual(['0', '10', '20', '30', '40']);
    expect(products).toHaveLength(50);
    expect(products[0]).toEqual({ id: 'p0' });
    expect(products[49]).toEqual({ id: 'p49' });
  });

  it('computes a different offset for different `pageNumber`-derived offsets, proving pages no longer repeat', async () => {
    const request = vi.fn(async (path: string) => {
      const url = new URL(`http://x${path}`);
      const offset = Number(url.searchParams.get('offset'));
      return [{ id: `p${offset}` }];
    });
    const svc = new UcRatioApiService(fakeTokens('tok'), { request } as unknown as RatioClient);

    const page1 = await svc.listProducts('m1', { offset: 0, limit: 1 });
    const page2 = await svc.listProducts('m1', { offset: 50, limit: 1 });

    expect(page1).toEqual([{ id: 'p0' }]);
    expect(page2).toEqual([{ id: 'p50' }]);
    expect(page1).not.toEqual(page2);
  });

  it('stops walking once a short response signals the end of the catalog', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(Array.from({ length: 10 }, (_, i) => ({ id: `p${i}` })))
      .mockResolvedValueOnce([{ id: 'p10' }, { id: 'p11' }]); // short => stop
    const svc = new UcRatioApiService(fakeTokens('tok'), { request } as unknown as RatioClient);

    const products = await svc.listProducts('m1', { offset: 0, limit: 50 });

    expect(request).toHaveBeenCalledTimes(2);
    expect(products).toHaveLength(12);
  });
});

describe('UcRatioApiService.updateVariantInventory', () => {
  it('PUTs /api/v1/v1/variants/:id with the inventory-nested body', async () => {
    const request = vi.fn().mockResolvedValue({});
    const svc = new UcRatioApiService(fakeTokens('tok'), { request } as unknown as RatioClient);

    await svc.updateVariantInventory('m1', 'v42', 7);

    expect(request).toHaveBeenCalledTimes(1);
    const [path, , options] = request.mock.calls[0] as [
      string,
      unknown,
      { method: string; body: unknown; accessToken: string },
    ];
    expect(path).toBe('/api/v1/v1/variants/v42');
    expect(options.method).toBe('PUT');
    expect(options.body).toEqual({ inventory: { quantity: 7 } });
    expect(options.accessToken).toBe('tok');
  });
});

describe('UcRatioApiService.listOrders', () => {
  it('GETs /api/v1/orders with page/limit params', async () => {
    const request = vi.fn().mockResolvedValue({ orders: [{ id: 'o1' }] });
    const svc = new UcRatioApiService(fakeTokens('tok'), { request } as unknown as RatioClient);

    const orders = await svc.listOrders('m1', { page: 3, pageSize: 25 });

    const [path] = request.mock.calls[0] as [string];
    expect(path).toBe('/api/v1/orders?page=3&limit=25');
    expect(orders).toEqual([{ id: 'o1' }]);
  });

  it('extracts items from a bare array envelope', async () => {
    const request = vi.fn().mockResolvedValue([{ id: 'o1' }, { id: 'o2' }]);
    const svc = new UcRatioApiService(fakeTokens(), { request } as unknown as RatioClient);

    const orders = await svc.listOrders('m1', { page: 1, pageSize: 50 });
    expect(orders).toEqual([{ id: 'o1' }, { id: 'o2' }]);
  });

  // TRD §2.3, confirmed bug fix: Ratio's Orders API has no `orderStatus`
  // filter — UC's `orderStatus=CREATED` must map to Ratio's own
  // `status=open&fulfillment_status=unfulfilled`, not be forwarded verbatim
  // (which Ratio's API would silently ignore, dumping every order unfiltered).
  it("maps UC's orderStatus=CREATED to Ratio's status=open&fulfillment_status=unfulfilled, not forwarded verbatim", async () => {
    const request = vi.fn().mockResolvedValue({ orders: [] });
    const svc = new UcRatioApiService(fakeTokens('tok'), { request } as unknown as RatioClient);

    await svc.listOrders('m1', { page: 1, pageSize: 50, orderStatus: 'CREATED' });

    const [path] = request.mock.calls[0] as [string];
    expect(path).toContain('status=open');
    expect(path).toContain('fulfillment_status=unfulfilled');
    expect(path).not.toContain('orderStatus=');
  });

  // Ratio's Orders API has no date-range query param at all — the
  // orderDateFrom/orderDateTo filter must be applied client-side, on
  // whatever the (unfiltered-by-date) request returns.
  it('filters the returned orders by orderDateFrom/orderDateTo client-side, since Ratio has no server-side date-range param', async () => {
    const request = vi.fn().mockResolvedValue({
      orders: [
        { id: 'too-old', created_at: '2026-01-01T00:00:00.000Z' },
        { id: 'in-range', created_at: '2026-01-10T00:00:00.000Z' },
        { id: 'too-new', created_at: '2026-01-20T00:00:00.000Z' },
      ],
    });
    const svc = new UcRatioApiService(fakeTokens('tok'), { request } as unknown as RatioClient);

    const orders = await svc.listOrders('m1', {
      page: 1,
      pageSize: 50,
      orderDateFrom: '2026-01-05T00:00:00.000Z',
      orderDateTo: '2026-01-15T00:00:00.000Z',
    });

    const [path] = request.mock.calls[0] as [string];
    expect(path).not.toContain('orderDateFrom');
    expect(path).not.toContain('orderDateTo');
    expect(orders).toEqual([{ id: 'in-range', created_at: '2026-01-10T00:00:00.000Z' }]);
  });

  it('returns everything unfiltered when no date range is given', async () => {
    const request = vi.fn().mockResolvedValue({ orders: [{ id: 'o1' }, { id: 'o2' }] });
    const svc = new UcRatioApiService(fakeTokens('tok'), { request } as unknown as RatioClient);

    const orders = await svc.listOrders('m1', { page: 1, pageSize: 50 });
    expect(orders).toEqual([{ id: 'o1' }, { id: 'o2' }]);
  });
});

describe('UcRatioApiService.getOrder', () => {
  it('GETs /api/v1/orders/:id and unwraps an `{ order: {...} }` envelope', async () => {
    const request = vi.fn().mockResolvedValue({ order: { id: 'o1', status: 'paid' } });
    const svc = new UcRatioApiService(fakeTokens('tok'), { request } as unknown as RatioClient);

    const order = await svc.getOrder('m1', 'o1');

    const [path] = request.mock.calls[0] as [string];
    expect(path).toBe('/api/v1/orders/o1');
    expect(order).toEqual({ id: 'o1', status: 'paid' });
  });

  it('returns the object itself when it is not wrapped', async () => {
    const request = vi.fn().mockResolvedValue({ id: 'o1', status: 'paid' });
    const svc = new UcRatioApiService(fakeTokens(), { request } as unknown as RatioClient);

    const order = await svc.getOrder('m1', 'o1');
    expect(order).toEqual({ id: 'o1', status: 'paid' });
  });
});

describe('UcRatioApiService.updateOrderFulfillment', () => {
  it('PATCHes /api/v1/orders/:id with the fulfillment_status + metafields body', async () => {
    const request = vi.fn().mockResolvedValue({});
    const svc = new UcRatioApiService(fakeTokens('tok'), { request } as unknown as RatioClient);

    await svc.updateOrderFulfillment('m1', 'o1', {
      fulfillment_status: 'fulfilled',
      metafields: [{ namespace: 'uc', key: 'shipment_id', value: 'S1', type: 'single_line_text_field' }],
    });

    const [path, , options] = request.mock.calls[0] as [
      string,
      unknown,
      { method: string; body: unknown },
    ];
    expect(path).toBe('/api/v1/orders/o1');
    expect(options.method).toBe('PATCH');
    expect(options.body).toEqual({
      fulfillment_status: 'fulfilled',
      metafields: [{ namespace: 'uc', key: 'shipment_id', value: 'S1', type: 'single_line_text_field' }],
    });
  });
});

describe('UcRatioApiService.updateOrderStatus', () => {
  it('PATCHes /api/v1/orders/:id with a narrower fulfillment_status body', async () => {
    const request = vi.fn().mockResolvedValue({});
    const svc = new UcRatioApiService(fakeTokens('tok'), { request } as unknown as RatioClient);

    await svc.updateOrderStatus('m1', 'o1', 'shipped');

    const [path, , options] = request.mock.calls[0] as [
      string,
      unknown,
      { method: string; body: unknown },
    ];
    expect(path).toBe('/api/v1/orders/o1');
    expect(options.method).toBe('PATCH');
    expect(options.body).toEqual({ fulfillment_status: 'shipped' });
  });
});

describe('UcRatioApiService.cancelOrder', () => {
  it('PATCHes /api/v1/orders/:id/cancel with no body', async () => {
    const request = vi.fn().mockResolvedValue({});
    const svc = new UcRatioApiService(fakeTokens('tok'), { request } as unknown as RatioClient);

    await svc.cancelOrder('m1', 'o1');

    const [path, , options] = request.mock.calls[0] as [string, unknown, { method: string }];
    expect(path).toBe('/api/v1/orders/o1/cancel');
    expect(options.method).toBe('PATCH');
  });
});

// TRD §2.7: a partial cancel (some, not all, of an order's items) must use
// the generic order PATCH with a line_items[] survivors array — the
// whole-order-cancel endpoint has no item-level granularity at all.
describe('UcRatioApiService.updateOrderLineItems', () => {
  it('PATCHes /api/v1/orders/:id with a line_items body (survivors only)', async () => {
    const request = vi.fn().mockResolvedValue({});
    const svc = new UcRatioApiService(fakeTokens('tok'), { request } as unknown as RatioClient);

    await svc.updateOrderLineItems('m1', 'o1', [{ id: 'line-2' }, { id: 'line-3' }]);

    const [path, , options] = request.mock.calls[0] as [string, unknown, { method: string; body: unknown }];
    expect(path).toBe('/api/v1/orders/o1');
    expect(options.method).toBe('PATCH');
    expect(options.body).toEqual({ line_items: [{ id: 'line-2' }, { id: 'line-3' }] });
  });
});

describe('UcRatioApiService — withAuthRetry self-healing end to end', () => {
  it('survives an upstream 401: the request runs with the stale token, then is retried once with the fresh token and succeeds', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(upstream401()) // first attempt with the stale token → 401
      .mockResolvedValueOnce({ orders: [{ id: 'o1' }] }); // retry with the fresh token → success
    const svc = new UcRatioApiService(retryingTokens('tok', 'tok-fresh'), { request } as unknown as RatioClient);

    const orders = await svc.listOrders('m1', { page: 1, pageSize: 50 });

    expect(orders).toEqual([{ id: 'o1' }]);
    expect(request).toHaveBeenCalledTimes(2);
    const first = request.mock.calls[0] as [string, unknown, { accessToken: string }];
    const second = request.mock.calls[1] as [string, unknown, { accessToken: string }];
    expect(first[2].accessToken).toBe('tok');
    expect(second[2].accessToken).toBe('tok-fresh');
  });
});
