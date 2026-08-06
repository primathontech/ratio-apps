import { HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('PATCHes a real OS order id (ordr_…) directly, skipping the order_number search entirely', async () => {
    // Regression: markOsOrderReturned.js (return_prime_public) passes order.id straight
    // from RP's synced OrderModel doc, which the OS order-sync webhook stores as the real
    // ordr_... id — NOT a Shopify-style order_number. Searching Ratio by that id string
    // either matches nothing or silently falls back to an unrelated order (orders[0] of a
    // non-matching search), so a real ordr_... id must skip the search and PATCH directly.
    const requestMock = vi.fn();
    requestMock.mockResolvedValueOnce({ order: { id: 'ordr_17860013548741545', tags: 'Returned' } });
    const svc = makeService(requestMock);

    const result = await svc.patchOrder('access-tok-1', 'gk-merchant', 'ordr_17860013548741545', {
      order: { tags: 'Returned' },
    });

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith(
      '/api/v1/orders/ordr_17860013548741545',
      expect.anything(),
      expect.objectContaining({
        method: 'PATCH',
        accessToken: 'access-tok-1',
        body: { tags: 'Returned', fulfillment_status: 'returned' },
      }),
    );
    expect(result).toEqual({ order: { id: 'ordr_17860013548741545', tags: 'Returned' } });
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
      // 'Exchanged' has no fulfillment_status value of its own anywhere in os-order's real
      // enum (confirmed against os-order/src/utils/constants.ts) — but the item genuinely
      // did come back to the merchant (just not for a refund), so it maps to the real,
      // valid 'returned' value rather than being dropped.
      expect.objectContaining({ body: { tags: 'gokwik, ratio, COD, Exchanged', fulfillment_status: 'returned' } }),
    );
  });

  // ── Deriving fulfillment_status from the tags RP is setting ────────────────
  // RP (return_prime_public) only ever sends `tags` via this call path — it does NOT send
  // fulfillment_status itself. buildReturnedTags there only ever adds "Returned" and/or
  // "Exchanged" (exact, case-sensitive) at request-APPROVAL time; markOsOrderRefunded adds
  // "Refunded" SEPARATELY, later, only once an actual refund completes. Both "Returned" and
  // "Exchanged" mean the same thing at the fulfillment level — the item physically came back
  // to the merchant — so both map to the real os-order fulfillmentStatus value 'returned'.
  // "Refunded" is a distinct, later, terminal event (money actually moved) and takes
  // precedence: a genuine return ends up 'refunded' once its refund call lands, while a pure
  // exchange has no refund call and correctly stays at 'returned' permanently — it never got
  // money back, it got a replacement item instead. 'exchanged' itself is never derived: it
  // is not a real value anywhere in os-order (checked fulfillment_status, financial_status,
  // and order status).

  it('derives fulfillment_status "returned" when the tags include "Returned"', async () => {
    const requestMock = vi.fn();
    stubOrderLookup(requestMock, 'ordr_9', '9');
    requestMock.mockResolvedValueOnce({ order: { id: 'ordr_9', tags: 'VIP, Returned' } });
    const svc = makeService(requestMock);

    await svc.patchOrder('access-tok-1', 'gk-merchant', '9', {
      order: { tags: ['VIP', 'Returned'] },
    });

    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/orders/ordr_9',
      expect.anything(),
      expect.objectContaining({ body: { tags: 'VIP, Returned', fulfillment_status: 'returned' } }),
    );
  });

  it('derives fulfillment_status "returned" when the tags include "Exchanged" (item came back, just not for a refund)', async () => {
    const requestMock = vi.fn();
    stubOrderLookup(requestMock, 'ordr_9', '9');
    requestMock.mockResolvedValueOnce({ order: { id: 'ordr_9', tags: 'VIP, Exchanged' } });
    const svc = makeService(requestMock);

    await svc.patchOrder('access-tok-1', 'gk-merchant', '9', {
      order: { tags: ['VIP', 'Exchanged'] },
    });

    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/orders/ordr_9',
      expect.anything(),
      expect.objectContaining({ body: { tags: 'VIP, Exchanged', fulfillment_status: 'returned' } }),
    );
  });

  it('derives fulfillment_status "refunded" when the tags include "Refunded"', async () => {
    const requestMock = vi.fn();
    stubOrderLookup(requestMock, 'ordr_9', '9');
    requestMock.mockResolvedValueOnce({ order: { id: 'ordr_9', tags: 'VIP, Refunded' } });
    const svc = makeService(requestMock);

    await svc.patchOrder('access-tok-1', 'gk-merchant', '9', {
      order: { tags: ['VIP', 'Refunded'] },
    });

    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/orders/ordr_9',
      expect.anything(),
      expect.objectContaining({ body: { tags: 'VIP, Refunded', fulfillment_status: 'refunded' } }),
    );
  });

  it('derives fulfillment_status "refunded" (not "returned") when tags include both "Refunded" and "Returned" — the refund is the later, terminal event', async () => {
    const requestMock = vi.fn();
    stubOrderLookup(requestMock, 'ordr_9', '9');
    requestMock.mockResolvedValueOnce({ order: { id: 'ordr_9', tags: 'Returned, Refunded' } });
    const svc = makeService(requestMock);

    await svc.patchOrder('access-tok-1', 'gk-merchant', '9', {
      order: { tags: ['Returned', 'Refunded'] },
    });

    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/orders/ordr_9',
      expect.anything(),
      expect.objectContaining({ body: { tags: 'Returned, Refunded', fulfillment_status: 'refunded' } }),
    );
  });

  it('does not override an already-explicit fulfillment_status even if tags also include "Returned"', async () => {
    const requestMock = vi.fn();
    stubOrderLookup(requestMock, 'ordr_9', '9');
    requestMock.mockResolvedValueOnce({ order: { id: 'ordr_9', tags: 'Returned' } });
    const svc = makeService(requestMock);

    await svc.patchOrder('access-tok-1', 'gk-merchant', '9', {
      order: { tags: ['Returned'], fulfillment_status: 'fulfilled' },
    });

    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/orders/ordr_9',
      expect.anything(),
      expect.objectContaining({ body: { tags: 'Returned', fulfillment_status: 'fulfilled' } }),
    );
  });

  it('surfaces a rejected patch (never masks a failure as success)', async () => {
    const requestMock = vi.fn();
    stubOrderLookup(requestMock, 'ordr_x', 'x');
    const error = new Error('order not found');
    // Persistent rejection — every PATCH attempt fails the same way, so the test
    // exercises genuine retry exhaustion (with `mockRejectedValueOnce` the retry
    // would "recover" on the next attempt and the failure would be masked).
    requestMock.mockRejectedValue(error);
    const svc = makeService(requestMock);

    await expect(
      svc.patchOrder('access-tok-1', 'gk-merchant', 'x', { order: { tags: 'Returned' } }),
    ).rejects.toThrow('order not found');
  });

  // ── Local retry of the outbound PATCH (network blip / timeout / transient 5xx) ──
  // The caller (return_prime_public) dispatches to this adapter fire-and-forget, so a
  // single failed call would be lost forever. We retry a few times locally; a 4xx is
  // NOT retried (Ratio will reject the same payload every time). Errors surface the way
  // RatioClient (core/ratio-client/ratio.client.ts) actually throws them: every non-2xx
  // upstream response is a 502 HttpException with the real status in `details.status`,
  // while network/timeout failures are plain (non-HttpException) errors.

  it('retries a transient network failure of the PATCH and succeeds on a later attempt', async () => {
    const requestMock = vi.fn();
    stubOrderLookup(requestMock, 'ordr_9', '9');
    // First PATCH attempt fails with a network-shaped error (plain TypeError, no status);
    // the retry succeeds.
    requestMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    requestMock.mockResolvedValueOnce({ order: { id: 'ordr_9', tags: 'Returned' } });
    const svc = makeService(requestMock);

    const result = await svc.patchOrder('access-tok-1', 'gk-merchant', '9', {
      order: { tags: 'Returned' },
    });

    expect(result).toEqual({ order: { id: 'ordr_9', tags: 'Returned' } });
    // order-number lookup + 2 PATCH attempts (1 initial + 1 retry)
    expect(requestMock).toHaveBeenCalledTimes(3);
    expect(requestMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/orders/ordr_9',
      expect.anything(),
      expect.objectContaining({ method: 'PATCH', accessToken: 'access-tok-1' }),
    );
  });

  it('retries a transient upstream 5xx of the PATCH and succeeds on a later attempt', async () => {
    const requestMock = vi.fn();
    stubOrderLookup(requestMock, 'ordr_9', '9');
    const upstream503 = new HttpException(
      {
        message: 'ratio upstream error',
        error_code: 'RATIO_UPSTREAM_ERROR',
        details: { status: 503 },
      },
      502,
    );
    requestMock.mockRejectedValueOnce(upstream503);
    requestMock.mockResolvedValueOnce({ order: { id: 'ordr_9', tags: 'Returned' } });
    const svc = makeService(requestMock);

    const result = await svc.patchOrder('access-tok-1', 'gk-merchant', '9', {
      order: { tags: 'Returned' },
    });

    expect(result).toEqual({ order: { id: 'ordr_9', tags: 'Returned' } });
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry a non-retryable upstream 4xx — fails on the first PATCH attempt', async () => {
    const requestMock = vi.fn();
    stubOrderLookup(requestMock, 'ordr_9', '9');
    const upstream404 = new HttpException(
      {
        message: 'ratio upstream error',
        error_code: 'RATIO_UPSTREAM_ERROR',
        details: { status: 404 },
      },
      502,
    );
    // A follow-up success is queued only so the test can prove it was never consumed:
    // if the 4xx were (wrongly) retried, the mock would resolve and the rejection
    // assertion below would fail.
    requestMock.mockRejectedValueOnce(upstream404);
    requestMock.mockResolvedValueOnce({ order: { id: 'ordr_9', tags: 'Returned' } });
    const svc = makeService(requestMock);

    await expect(
      svc.patchOrder('access-tok-1', 'gk-merchant', '9', { order: { tags: 'Returned' } }),
    ).rejects.toBe(upstream404);
    // order-number lookup + exactly ONE PATCH attempt — the queued success was never used
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('still fails with the same rejection after exhausting all retries on persistent transient failure', async () => {
    const requestMock = vi.fn();
    stubOrderLookup(requestMock, 'ordr_9', '9');
    const error = new TypeError('fetch failed');
    requestMock.mockRejectedValue(error); // every PATCH attempt fails the same way
    const svc = makeService(requestMock);

    await expect(
      svc.patchOrder('access-tok-1', 'gk-merchant', '9', { order: { tags: 'Returned' } }),
    ).rejects.toThrow('fetch failed');
    // order-number lookup + 3 PATCH attempts (1 initial + 2 retries) — nothing swallowed
    expect(requestMock).toHaveBeenCalledTimes(4);
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

  it('propagates the error instead of swallowing it (so withAuthRetry can react to a 401)', async () => {
    const requestMock = vi.fn().mockRejectedValue(new Error('upstream down'));
    const svc = makeService(requestMock);

    await expect(svc.listProducts('access-tok-1', 'gk-merchant', 1, 50)).rejects.toThrow('upstream down');
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

  it('uses the access token — not the merchant id — for the internal order-number lookup', async () => {
    const requestMock = vi.fn();
    stubOrderLookup(requestMock, 'ordr_real123', '2439');
    requestMock.mockResolvedValueOnce({ totalAmount: 35900, currency: 'INR' });
    const svc = makeService(requestMock);

    await svc.calculateRefund('access-tok-1', 'gk-merchant', '2439', {
      line_items: [{ line_item_id: '700', quantity: 1 }],
      include_shipping: false,
      reason: 'test',
    });

    expect(requestMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/api/v1/orders?search='),
      expect.anything(),
      expect.objectContaining({ accessToken: 'access-tok-1' }),
    );
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

  it('uses the access token — not the merchant id — for the internal order-number lookup', async () => {
    const requestMock = vi.fn();
    stubOrderLookup(requestMock, 'ordr_real123', '2439');
    requestMock.mockResolvedValueOnce([{ id: 'ref_1' }]);
    const svc = makeService(requestMock);

    await svc.getRefunds('access-tok-1', 'gk-merchant', '2439');

    expect(requestMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/api/v1/orders?search='),
      expect.anything(),
      expect.objectContaining({ accessToken: 'access-tok-1' }),
    );
  });
});
