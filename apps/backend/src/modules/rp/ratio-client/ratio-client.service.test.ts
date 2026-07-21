import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { RpRatioClientService } from './ratio-client.service';

function makeService(): RpRatioClientService {
  const config = { get: () => 'http://os-order.test' } as never;
  const ratio = {} as never;
  return new RpRatioClientService(ratio, config);
}

describe('RpRatioClientService.createOrder', () => {
  afterEach(() => vi.restoreAllMocks());

  it('throws when the OS order service returns a non-ok response (does not mask a 400 as a fake order)', async () => {
    // Regression: a rejected exchange order (e.g. "shippingAddress.zip should not be empty")
    // used to flow back as the response body, which normalizeOrder turned into { id: 0, ... }.
    // RP then marked the exchange "success" with order:0 and created nothing. The client must
    // surface the failure instead of masking it.
    const errorBody = {
      message: ['shippingAddress.zip should not be empty'],
      error: 'Bad Request',
      statusCode: 400,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve(errorBody),
      }),
    );

    const svc = makeService();
    await expect(svc.createOrder('gk-merchant', { order: {} })).rejects.toThrow();
  });

  it('preserves the OS status code and body so RP sees the real reason (not an opaque 500)', async () => {
    const errorBody = { code: 'ORDER_FULLY_REFUNDED', message: 'No refundable amount remaining' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve(errorBody),
      }),
    );

    const svc = makeService();
    try {
      await svc.createOrder('gk-merchant', { order: {} });
      throw new Error('expected createOrder to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(422);
      expect((err as HttpException).getResponse()).toMatchObject({ os: errorBody });
    }
  });

  it('returns the parsed body on a successful create', async () => {
    const okBody = { data: { order: { id: 'ordr_1', order_number: 2511 } } };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve(okBody),
      }),
    );

    const svc = makeService();
    await expect(svc.createOrder('gk-merchant', { order: {} })).resolves.toEqual(okBody);
  });
});

describe('RpRatioClientService.patchOrder', () => {
  afterEach(() => vi.restoreAllMocks());

  it('PATCHes the OS order service order with the unwrapped order fields (tags/fulfillment_status)', async () => {
    const okBody = { data: { order: { id: 'ordr_9', tags: 'Returned' } } };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(okBody),
    });
    vi.stubGlobal('fetch', fetchMock);

    const svc = makeService();
    const result = await svc.patchOrder('gk-merchant', 'ordr_9', {
      order: { tags: 'Returned', fulfillment_status: 'fulfilled' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://os-order.test/api/v1/admin/orders/ordr_9',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'gk-merchant-id': 'gk-merchant', 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: 'Returned', fulfillment_status: 'fulfilled' }),
      }),
    );
    expect(result).toEqual(okBody);
  });

  it('resolves an order_number (e.g. "500", what RP actually sends) to the real OS order id before PATCHing — reproduces a live 404 ("Order with ID 500 not found") seen when this resolution was missing', async () => {
    const searchBody = { data: { orders: [{ id: 'ordr_17846309512358540', order_number: 500 }] } };
    const okBody = { data: { order: { id: 'ordr_17846309512358540', tags: 'Returned' } } };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(searchBody) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(okBody) });
    vi.stubGlobal('fetch', fetchMock);

    const svc = makeService();
    const result = await svc.patchOrder('gk-merchant', '500', {
      order: { tags: 'Returned', fulfillment_status: 'fulfilled' },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://os-order.test/api/v1/admin/orders?search=500',
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://os-order.test/api/v1/admin/orders/ordr_17846309512358540',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(result).toEqual(okBody);
  });

  it('surfaces a non-ok OS response as an HttpException (never masks a failure as success)', async () => {
    const errorBody = { code: 'ORDER_NOT_FOUND', message: 'no such order' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve(errorBody),
      }),
    );

    const svc = makeService();
    try {
      await svc.patchOrder('gk-merchant', 'ordr_x', { order: { tags: 'Returned' } });
      throw new Error('expected patchOrder to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(404);
      expect((err as HttpException).getResponse()).toMatchObject({ os: errorBody });
    }
  });
});
