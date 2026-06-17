import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ContentApiClient,
  ContentApiError,
  type BatchEntry,
} from '../../../../src/modules/google/gmc/content-api.client';

const BASE = 'https://shoppingcontent.googleapis.com/content/v2.1';
const MERCHANT_ID = '123456';
const TOKEN = 'ya29.test-access-token';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

function makeClient(fetchImpl: typeof fetch) {
  return new ContentApiClient({
    merchantId: MERCHANT_ID,
    getAccessToken: async () => TOKEN,
    fetchImpl,
  });
}

describe('ContentApiClient', () => {
  let calls: RecordedCall[];

  beforeEach(() => {
    calls = [];
  });

  function recorder(handler: () => Response): typeof fetch {
    return vi.fn((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(handler());
    }) as unknown as typeof fetch;
  }

  it('insertProduct POSTs to the right URL with Bearer token and JSON body and returns the parsed resource', async () => {
    const fetchImpl = recorder(() => jsonResponse({ id: 'online:en:US:abc' }));
    const client = makeClient(fetchImpl);

    const result = await client.insertProduct({ offerId: 'abc', title: 'Hat' });

    expect(result).toEqual({ id: 'online:en:US:abc' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/${MERCHANT_ID}/products`);
    expect(calls[0].init?.method).toBe('POST');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['Content-Type']).toBe('application/json');
    expect(calls[0].init?.body).toBe(
      JSON.stringify({ offerId: 'abc', title: 'Hat' }),
    );
  });

  it('updateProduct PUTs to the products/<encoded id> URL', async () => {
    const fetchImpl = recorder(() => jsonResponse({ id: 'online:en:US:a b' }));
    const client = makeClient(fetchImpl);

    await client.updateProduct('online:en:US:a b', { title: 'New' });

    expect(calls[0].init?.method).toBe('PUT');
    expect(calls[0].url).toBe(
      `${BASE}/${MERCHANT_ID}/products/${encodeURIComponent('online:en:US:a b')}`,
    );
  });

  it('deleteProduct DELETEs and resolves on 204', async () => {
    const fetchImpl = recorder(() => new Response(null, { status: 204 }));
    const client = makeClient(fetchImpl);

    await expect(client.deleteProduct('online:en:US:abc')).resolves.toBeUndefined();

    expect(calls[0].init?.method).toBe('DELETE');
    expect(calls[0].url).toBe(
      `${BASE}/${MERCHANT_ID}/products/${encodeURIComponent('online:en:US:abc')}`,
    );
  });

  it('listProducts GETs and returns { resources, nextPageToken }', async () => {
    const fetchImpl = recorder(() =>
      jsonResponse({
        resources: [{ id: 'p1' }, { id: 'p2' }],
        nextPageToken: 'next-123',
      }),
    );
    const client = makeClient(fetchImpl);

    const result = await client.listProducts();

    expect(result).toEqual({
      resources: [{ id: 'p1' }, { id: 'p2' }],
      nextPageToken: 'next-123',
    });
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[0].url).toBe(`${BASE}/${MERCHANT_ID}/products?maxResults=250`);
  });

  it('listProducts appends pageToken when present', async () => {
    const fetchImpl = recorder(() => jsonResponse({ resources: [] }));
    const client = makeClient(fetchImpl);

    await client.listProducts('tok 1');

    expect(calls[0].url).toBe(
      `${BASE}/${MERCHANT_ID}/products?maxResults=250&pageToken=${encodeURIComponent('tok 1')}`,
    );
  });

  it('custombatch POSTs { entries } to /products/batch', async () => {
    const fetchImpl = recorder(() => jsonResponse({ entries: [{ batchId: 1 }] }));
    const client = makeClient(fetchImpl);

    const entries: BatchEntry[] = [
      { batchId: 1, merchantId: MERCHANT_ID, method: 'insert', product: { offerId: 'a' } },
    ];
    const result = await client.custombatch(entries);

    expect(result).toEqual({ entries: [{ batchId: 1 }] });
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].url).toBe(`${BASE}/products/batch`);
    expect(calls[0].init?.body).toBe(JSON.stringify({ entries }));
  });

  it('throws ContentApiError with the Google error message and status on a non-2xx response', async () => {
    const fetchImpl = recorder(() =>
      jsonResponse({ error: { message: 'Invalid product data' } }, 400),
    );
    const client = makeClient(fetchImpl);

    await expect(client.insertProduct({})).rejects.toMatchObject({
      name: 'ContentApiError',
      message: 'Invalid product data',
      status: 400,
    });
    const error = await client.insertProduct({}).catch((e) => e);
    expect(error).toBeInstanceOf(ContentApiError);
    expect(error.isRateLimited).toBe(false);
  });

  it('sets isRateLimited true on a 429 response', async () => {
    const fetchImpl = recorder(() =>
      jsonResponse({ error: { message: 'Rate limit exceeded' } }, 429),
    );
    const client = makeClient(fetchImpl);

    const error = await client.insertProduct({}).catch((e) => e);
    expect(error).toBeInstanceOf(ContentApiError);
    expect(error.status).toBe(429);
    expect(error.isRateLimited).toBe(true);
  });

  it('getAuthinfo GETs accounts/authinfo and returns the merchant ids', async () => {
    const fetchImpl = recorder(() =>
      jsonResponse({ accountIdentifiers: [{ merchantId: '1234567' }, { aggregatorId: '99' }] }),
    );
    const client = makeClient(fetchImpl);

    const accounts = await client.getAuthinfo();

    expect(accounts).toEqual([{ merchantId: '1234567' }]);
    expect(calls[0].url).toBe(`${BASE}/accounts/authinfo`);
    expect(calls[0].init?.method).toBe('GET');
  });

  it('chunk splits 12 items into [5, 5, 2]', () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    const chunks = ContentApiClient.chunk(items, 5);
    expect(chunks.map((c) => c.length)).toEqual([5, 5, 2]);
  });

  it('awaits getAccessToken and uses its resolved value as the Bearer token', async () => {
    const getAccessToken = vi.fn(async () => 'resolved-token');
    const fetchImpl = recorder(() => jsonResponse({ id: 'x' }));
    const client = new ContentApiClient({
      merchantId: MERCHANT_ID,
      getAccessToken,
      fetchImpl,
    });

    await client.insertProduct({ offerId: 'a' });

    expect(getAccessToken).toHaveBeenCalledTimes(1);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer resolved-token');
  });
});
