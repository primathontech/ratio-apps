import { describe, expect, it, vi } from 'vitest';
import { WizzyClient } from './client';

function mockFetch(json: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(json), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

const cfg = { baseUrl: 'https://api.wizsearch.in/v1', storeId: 's1', apiKey: 'pub', userId: 'u1' };

describe('WizzyClient', () => {
  it('sends public auth headers and form body to /autocomplete', async () => {
    const fetchImpl = mockFetch({
      payload: { categories: [], brands: [], others: [], products: [] },
    });
    const c = new WizzyClient(cfg, fetchImpl as unknown as typeof fetch);
    await c.autocomplete('crea', { productsCount: 6 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.wizsearch.in/v1/autocomplete');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-store-id']).toBe('s1');
    expect(headers['x-api-key']).toBe('pub');
    expect(headers['x-wizzy-userId']).toBe('u1');
    expect(headers).not.toHaveProperty('x-store-secret');
    expect(String(init.body)).toContain('q=crea');
    expect(String(init.body)).toContain('productsCount=6');
  });

  it('aborts the previous autocomplete when a new one starts', async () => {
    const fetchImpl = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise((_res, rej) =>
          (init.signal as AbortSignal).addEventListener('abort', () =>
            rej(new DOMException('aborted', 'AbortError')),
          ),
        ),
    );
    const c = new WizzyClient(cfg, fetchImpl as unknown as typeof fetch);
    const p1 = c.autocomplete('a').catch((e) => e);
    c.autocomplete('ab').catch(() => {});
    const err = await p1;
    expect(err.name).toBe('AbortError');
  });

  it('search posts to /products/search', async () => {
    const fetchImpl = mockFetch({ payload: { result: [], total: 0, pages: 0, facets: [] } });
    const c = new WizzyClient(cfg, fetchImpl as unknown as typeof fetch);
    const r = await c.search('creatine', { productsCount: 24 });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://api.wizsearch.in/v1/products/search',
    );
    expect(r.payload.total).toBe(0);
  });

  it('filter sends the filter model as a JSON string param', async () => {
    const fetchImpl = mockFetch({ payload: { result: [], total: 0, pages: 0, facets: [] } });
    const c = new WizzyClient(cfg, fetchImpl as unknown as typeof fetch);
    await c.filter(
      { brands: ['Wellcore'], sellingPrice: [{ gte: 100, lte: 900 }] },
      { q: 'creatine' },
    );
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    const body = String(init.body);
    expect(body).toContain('filters=');
    expect(decodeURIComponent(body)).toContain('"brands":["Wellcore"]');
  });

  it('trending GETs /trendingSearches', async () => {
    const fetchImpl = mockFetch({ payload: { queries: ['creatine', 'pre-workout'] } });
    const c = new WizzyClient(cfg, fetchImpl as unknown as typeof fetch);
    const r = await c.trending(6);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain(
      '/trendingSearches?size=6',
    );
    expect(r.payload.queries).toContain('creatine');
  });

  it('event posts to /events/<kind> and never throws on failure', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    const c = new WizzyClient(cfg, fetchImpl as unknown as typeof fetch);
    await expect(c.event('click', { productId: '1' })).resolves.toBeUndefined();
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://api.wizsearch.in/v1/events/click',
    );
  });
});
