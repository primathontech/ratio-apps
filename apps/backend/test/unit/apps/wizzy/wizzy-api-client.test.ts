import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WizzyApiClient, WizzyApiError } from '../../../../src/modules/wizzy/catalog/wizzy-api.client';
import type { WizzyProductPayload } from '../../../../src/modules/wizzy/catalog/wizzy-transform';

const STORE_ID = 'store-123';
const STORE_SECRET = 'secret-abc';
const API_KEY = 'key-xyz';

function makeFetch(status: number, body: unknown = {}): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response);
}

const sampleProduct: WizzyProductPayload = {
  id: 'prod-1',
  name: 'Test Product',
  mainImage: 'https://img.example.com/1.jpg',
  categories: [{ id: 'apparel', name: 'Apparel', parentId: '', pathIds: ['apparel'] }],
  sellingPrice: 999,
};

describe('WizzyApiClient — saveProducts', () => {
  it('sends POST to /products/save with array body', async () => {
    const fetchFn = makeFetch(200);
    const client = new WizzyApiClient(fetchFn);
    await client.saveProducts(STORE_ID, STORE_SECRET, API_KEY, [sampleProduct]);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/products\/save$/);
    expect(init.method).toBe('POST');
    const bodyParsed = JSON.parse(init.body as string);
    // Body must be the array directly (not wrapped in an object)
    expect(Array.isArray(bodyParsed)).toBe(true);
    expect(bodyParsed[0].id).toBe('prod-1');
  });

  it('sends all three required auth headers', async () => {
    const fetchFn = makeFetch(200);
    const client = new WizzyApiClient(fetchFn);
    await client.saveProducts(STORE_ID, STORE_SECRET, API_KEY, []);

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-store-id']).toBe(STORE_ID);
    expect(headers['x-store-secret']).toBe(STORE_SECRET);
    expect(headers['x-api-key']).toBe(API_KEY);
  });

  it('throws WizzyApiError on non-2xx', async () => {
    const fetchFn = makeFetch(401, { message: 'Unauthorized' });
    const client = new WizzyApiClient(fetchFn);
    await expect(client.saveProducts(STORE_ID, STORE_SECRET, API_KEY, [])).rejects.toThrowError(
      WizzyApiError,
    );
  });
});

describe('WizzyApiClient — deleteProducts', () => {
  it('sends DELETE to /products/delete with id array body', async () => {
    const fetchFn = makeFetch(200);
    const client = new WizzyApiClient(fetchFn);
    await client.deleteProducts(STORE_ID, STORE_SECRET, API_KEY, ['id1', 'id2']);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/products\/delete$/);
    expect(init.method).toBe('DELETE');
    const bodyParsed = JSON.parse(init.body as string);
    // Body must be the array directly (not wrapped in an object)
    expect(Array.isArray(bodyParsed)).toBe(true);
    expect(bodyParsed).toEqual(['id1', 'id2']);
  });

  it('sends all three required auth headers on DELETE', async () => {
    const fetchFn = makeFetch(200);
    const client = new WizzyApiClient(fetchFn);
    await client.deleteProducts(STORE_ID, STORE_SECRET, API_KEY, ['id1']);

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-store-id']).toBe(STORE_ID);
    expect(headers['x-store-secret']).toBe(STORE_SECRET);
    expect(headers['x-api-key']).toBe(API_KEY);
  });
});

describe('WizzyApiClient — testConnection', () => {
  it('calls saveProducts with empty array and returns ok:true on 2xx', async () => {
    const fetchFn = makeFetch(200);
    const client = new WizzyApiClient(fetchFn);
    const result = await client.testConnection(STORE_ID, STORE_SECRET, API_KEY);

    expect(result.ok).toBe(true);
    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/products\/save$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual([]);
  });

  it('returns ok:false on 401', async () => {
    const fetchFn = makeFetch(401, { message: 'bad creds' });
    const client = new WizzyApiClient(fetchFn);
    const result = await client.testConnection(STORE_ID, STORE_SECRET, API_KEY);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/401/);
  });

  it('returns ok:true when Wizzy rejects the empty array for "no products" (valid auth)', async () => {
    // Real Wizzy response to an empty-array /products/save: HTTP 200 but body
    // statusCode 400 "Please add at least one product." — auth succeeded, only
    // the (intentionally empty) payload was rejected. This must read as valid.
    const fetchFn = makeFetch(200, {
      status: 0,
      statusCode: 400,
      message: 'Please fix the issues to feed products.',
      payload: { params: { products: '0', error: 'Please add at least one product for sync.' } },
    });
    const client = new WizzyApiClient(fetchFn);
    const result = await client.testConnection(STORE_ID, STORE_SECRET, API_KEY);
    expect(result.ok).toBe(true);
  });
});

describe('WizzyApiError', () => {
  it('marks 429 as rate-limited and transient', () => {
    const err = new WizzyApiError(429, 'rate limited');
    expect(err.isRateLimited).toBe(true);
    expect(err.isTransient).toBe(true);
  });

  it('marks 5xx as transient (not rate-limited)', () => {
    const err = new WizzyApiError(503, 'service unavailable');
    expect(err.isRateLimited).toBe(false);
    expect(err.isTransient).toBe(true);
  });

  it('marks 4xx (not 429) as permanent', () => {
    const err = new WizzyApiError(422, 'unprocessable');
    expect(err.isRateLimited).toBe(false);
    expect(err.isTransient).toBe(false);
  });

  it('marks status 0 (network error) as transient', () => {
    const err = new WizzyApiError(0, 'network error');
    expect(err.isTransient).toBe(true);
  });
});
