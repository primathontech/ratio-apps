import { describe, it, expect, vi, afterEach } from 'vitest';
import { RpRatioClientService } from './ratio-client.service';

// Everything in this service goes through Ratio's ecosystem app API (OAuth bearer via
// RpRatioTokenProvider) now — orders/products/variants were moved off direct OS Order
// Service / OS Item Service calls (gk-merchant-id header) onto Ratio's own
// /api/v1/orders, /api/v1/v1/products, /api/v1/v1/variants, matching the pattern
// discounts/customers/refunds already used. No method in this file should call the
// global `fetch` directly anymore.
function makeService(requestMock: ReturnType<typeof vi.fn>): RpRatioClientService {
  return new RpRatioClientService({ request: requestMock } as never);
}

function stubOrderLookup(requestMock: ReturnType<typeof vi.fn>, osOrderId: string, orderNumber: string) {
  requestMock.mockResolvedValueOnce({ orders: [{ id: osOrderId, order_number: Number(orderNumber) }] });
}

describe('RpRatioClientService.getOrders', () => {
  afterEach(() => vi.restoreAllMocks());

  it('maps a Shopify-style `name` param to Ratio\'s `search` param', async () => {
    const requestMock = vi.fn().mockResolvedValue({ orders: [] });
    const svc = makeService(requestMock);

    await svc.getOrders('access-tok-1', { name: '2511', status: 'any' });

    expect(requestMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/orders?'),
      expect.anything(),
      expect.objectContaining({ accessToken: 'access-tok-1' }),
    );
    const [url] = requestMock.mock.calls[0]!;
    expect(url).toContain('search=2511');
    expect(url).toContain('status=any');
    expect(url).not.toContain('name=');
  });
});

describe('RpRatioClientService.getOrder', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fetches directly by id when given a real OS order id (ordr_…)', async () => {
    const requestMock = vi.fn().mockResolvedValue({ order: { id: 'ordr_9', order_number: 500 } });
    const svc = makeService(requestMock);

    const result = await svc.getOrder('access-tok-1', 'ordr_9');

    expect(requestMock).toHaveBeenCalledWith(
      '/api/v1/orders/ordr_9',
      expect.anything(),
      expect.objectContaining({ accessToken: 'access-tok-1' }),
    );
    expect(result).toEqual({ order: { id: 'ordr_9', order_number: 500 } });
  });

  it('searches by order_number when given a plain number (what RP actually sends) and picks the matching order', async () => {
    const requestMock = vi.fn().mockResolvedValue({
      orders: [{ id: 'ordr_other', order_number: 501 }, { id: 'ordr_match', order_number: 500 }],
    });
    const svc = makeService(requestMock);

    const result = await svc.getOrder('access-tok-1', '500');

    expect(requestMock).toHaveBeenCalledWith(
      '/api/v1/orders?search=500',
      expect.anything(),
      expect.objectContaining({ accessToken: 'access-tok-1' }),
    );
    expect(result).toEqual({ order: { id: 'ordr_match', order_number: 500 } });
  });
});

describe('RpRatioClientService.patchOrder', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolves an order_number (e.g. "500", what RP actually sends) to the real order id before PATCHing', async () => {
    const requestMock = vi.fn();
    stubOrderLookup(requestMock, 'ordr_17846309512358540', '500');
    requestMock.mockResolvedValueOnce({ order: { id: 'ordr_17846309512358540', tags: 'Returned' } });
    const svc = makeService(requestMock);

    const result = await svc.patchOrder('access-tok-1', 'gk-merchant', '500', {
      order: { tags: 'Returned', fulfillment_status: 'fulfilled' },
    });

    expect(requestMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/orders?search=500',
      expect.anything(),
      expect.objectContaining({ accessToken: 'access-tok-1' }),
    );
    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/orders/ordr_17846309512358540',
      expect.anything(),
      expect.objectContaining({
        method: 'PATCH',
        accessToken: 'access-tok-1',
        body: { tags: 'Returned', fulfillment_status: 'fulfilled' },
      }),
    );
    expect(result).toEqual({ order: { id: 'ordr_17846309512358540', tags: 'Returned' } });
  });

  it('joins an array-shaped tags field into a comma-separated string before PATCHing — Ratio\'s UpdateOrderDto types tags as a string', async () => {
    // Matches return_prime_public's markOsOrderReturned.js: buildReturnedTags() returns
    // [...new Set([...existing, ...add])] — a plain array.
    const requestMock = vi.fn();
    stubOrderLookup(requestMock, 'ordr_9', '9');
    requestMock.mockResolvedValueOnce({ order: { id: 'ordr_9', tags: 'gokwik, ratio, COD, Exchanged' } });
    const svc = makeService(requestMock);

    await svc.patchOrder('access-tok-1', 'gk-merchant', '9', {
      order: { tags: ['gokwik', 'ratio', 'COD', 'Exchanged'] },
    });

    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/orders/ordr_9',
      expect.anything(),
      expect.objectContaining({ body: { tags: 'gokwik, ratio, COD, Exchanged' } }),
    );
  });

  it('surfaces a rejected patch (never masks a failure as success)', async () => {
    const requestMock = vi.fn();
    stubOrderLookup(requestMock, 'ordr_x', 'x');
    const error = new Error('order not found');
    requestMock.mockRejectedValueOnce(error);
    const svc = makeService(requestMock);

    await expect(
      svc.patchOrder('access-tok-1', 'gk-merchant', 'x', { order: { tags: 'Returned' } }),
    ).rejects.toThrow('order not found');
  });
});

describe('RpRatioClientService.createOrder', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POSTs to Ratio\'s orders endpoint and returns the parsed body on success', async () => {
    const okBody = { order: { id: 'ordr_1', order_number: 2511 } };
    const requestMock = vi.fn().mockResolvedValue(okBody);
    const svc = makeService(requestMock);

    const result = await svc.createOrder('access-tok-1', 'gk-merchant', { order: {} });

    expect(requestMock).toHaveBeenCalledWith(
      '/api/v1/orders',
      expect.anything(),
      expect.objectContaining({ method: 'POST', accessToken: 'access-tok-1', body: { order: {} } }),
    );
    expect(result).toEqual(okBody);
  });

  it('propagates a rejected create (never masks a failure as a fake { id: 0 } order)', async () => {
    // Regression: a rejected exchange order used to flow back as a response body that
    // normalizeOrder turned into { id: 0, ... } — RP then marked the exchange "success"
    // with order:0 and created nothing.
    const error = new Error('shippingAddress.zip should not be empty');
    const requestMock = vi.fn().mockRejectedValue(error);
    const svc = makeService(requestMock);

    await expect(svc.createOrder('access-tok-1', 'gk-merchant', { order: {} })).rejects.toThrow(
      'shippingAddress.zip should not be empty',
    );
  });
});

describe('RpRatioClientService.getProduct', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fetches a product by id from Ratio', async () => {
    const okBody = { product: { id: 'prod-1', variants: [] } };
    const requestMock = vi.fn().mockResolvedValue(okBody);
    const svc = makeService(requestMock);

    const result = await svc.getProduct('access-tok-1', 'gk-merchant', 'prod-1');

    expect(requestMock).toHaveBeenCalledWith(
      '/api/v1/v1/products/prod-1',
      expect.anything(),
      expect.objectContaining({ accessToken: 'access-tok-1' }),
    );
    expect(result).toEqual(okBody);
  });
});

describe('RpRatioClientService.listProducts', () => {
  afterEach(() => vi.restoreAllMocks());

  it('pages the Ratio product catalog and reports hasNext from the pagination envelope', async () => {
    const requestMock = vi.fn().mockResolvedValue({
      products: [{ id: 'p1' }, { id: 'p2' }],
      pagination: { hasNext: true },
    });
    const svc = makeService(requestMock);

    const result = await svc.listProducts('access-tok-1', 'gk-merchant', 1, 50);

    expect(requestMock).toHaveBeenCalledWith(
      '/api/v1/v1/products?page=1&limit=50',
      expect.anything(),
      expect.objectContaining({ accessToken: 'access-tok-1' }),
    );
    expect(result).toEqual({ products: [{ id: 'p1' }, { id: 'p2' }], hasNext: true });
  });

  it('returns an empty page instead of throwing when the request fails', async () => {
    const requestMock = vi.fn().mockRejectedValue(new Error('upstream down'));
    const svc = makeService(requestMock);

    const result = await svc.listProducts('access-tok-1', 'gk-merchant', 1, 50);

    expect(result).toEqual({ products: [], hasNext: false });
  });
});

describe('RpRatioClientService.getVariant', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fetches a variant by id from Ratio and unwraps the data envelope', async () => {
    const requestMock = vi.fn().mockResolvedValue({ data: { id: 'var-1', inventory_quantity: 7 } });
    const svc = makeService(requestMock);

    const result = await svc.getVariant('access-tok-1', 'var-1');

    expect(requestMock).toHaveBeenCalledWith(
      '/api/v1/v1/variants/var-1',
      expect.anything(),
      expect.objectContaining({ accessToken: 'access-tok-1' }),
    );
    expect(result).toEqual({ id: 'var-1', inventory_quantity: 7 });
  });
});

describe('RpRatioClientService.setVariantInventory', () => {
  afterEach(() => vi.restoreAllMocks());

  it('PUTs the absolute quantity nested under inventory.quantity (Ratio\'s InventoryDto shape)', async () => {
    const okBody = { data: { id: 'var-1', inventory_quantity: 12 } };
    const requestMock = vi.fn().mockResolvedValue(okBody);
    const svc = makeService(requestMock);

    const result = await svc.setVariantInventory('access-tok-1', 'var-1', 12);

    expect(requestMock).toHaveBeenCalledWith(
      '/api/v1/v1/variants/var-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PUT',
        accessToken: 'access-tok-1',
        body: { inventory: { quantity: 12 } },
      }),
    );
    expect(result).toEqual(okBody);
  });
});

describe('RpRatioClientService.calculateRefund', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolves the real order id and calls the Ratio ecosystem refunds/calculate endpoint with the access token', async () => {
    const requestMock = vi.fn();
    stubOrderLookup(requestMock, 'ordr_real123', '2439');
    requestMock.mockResolvedValueOnce({ totalAmount: 35900, currency: 'INR' });
    const svc = makeService(requestMock);

    const result = await svc.calculateRefund('access-tok-1', 'gk-merchant', '2439', {
      line_items: [{ line_item_id: '700', quantity: 1 }],
      include_shipping: false,
      reason: 'test',
    });

    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/refunds/calculate',
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        accessToken: 'access-tok-1',
        body: expect.objectContaining({
          order_id: 'ordr_real123',
          line_items: [{ line_item_id: '700', quantity: 1 }],
        }),
      }),
    );
    expect(result).toEqual({ totalAmount: 35900, currency: 'INR' });
  });
});

describe('RpRatioClientService.createRefund', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolves the real order id and POSTs to the Ratio ecosystem refunds endpoint with an idempotency key and the access token', async () => {
    const requestMock = vi.fn();
    stubOrderLookup(requestMock, 'ordr_real123', '2439');
    requestMock.mockResolvedValueOnce({ id: 'ref_1', totalAmount: 52522 });
    const svc = makeService(requestMock);

    const result = await svc.createRefund('access-tok-1', 'gk-merchant', '2439', {
      line_items: [{ line_item_id: '700', quantity: 1 }],
      include_shipping: false,
      restock_type: 'CANCEL',
      notify_customer: true,
      reason: 'test',
    });

    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/refunds',
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        accessToken: 'access-tok-1',
        headers: expect.objectContaining({ 'x-idempotency-key': expect.any(String) }),
        body: expect.objectContaining({ order_id: 'ordr_real123' }),
      }),
    );
    expect(result).toEqual({ id: 'ref_1', totalAmount: 52522 });
  });
});

describe('RpRatioClientService.getRefunds', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolves the real order id and GETs the Ratio ecosystem list-refunds-for-order endpoint with the access token', async () => {
    const requestMock = vi.fn();
    stubOrderLookup(requestMock, 'ordr_real123', '2439');
    requestMock.mockResolvedValueOnce([{ id: 'ref_1' }]);
    const svc = makeService(requestMock);

    const result = await svc.getRefunds('access-tok-1', 'gk-merchant', '2439');

    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/orders/ordr_real123/refunds',
      expect.anything(),
      expect.objectContaining({ accessToken: 'access-tok-1' }),
    );
    expect(result).toEqual([{ id: 'ref_1' }]);
  });
});
