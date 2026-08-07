import { describe, expect, it, vi } from 'vitest';
import { RatioProductSourceClient } from '../../../../src/modules/clevertap/sync/product-source.client';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('RatioProductSourceClient', () => {
  it('paginates until hasNext is false and returns every product', async () => {
    const pages = [
      { products: [{ id: '1' }, { id: '2' }], pagination: { hasNext: true } },
      { products: [{ id: '3' }], pagination: { hasNext: false } },
    ];
    let call = 0;
    const fetchImpl = vi.fn(async () => jsonResponse(pages[call++]));
    const client = new RatioProductSourceClient(
      { getAccessToken: async () => 'tok' },
      { baseUrl: 'https://x', fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    const all = await client.fetchAllProducts('m1');

    expect(all.map((p) => p.id)).toEqual(['1', '2', '3']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [firstUrl, firstInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(firstUrl)).toContain('/api/v1/v1/products');
    expect((firstInit.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('refreshes the token once on a 401 and retries the same page', async () => {
    const tokens = {
      getAccessToken: vi.fn(async (_m: string, opts?: { forceRefresh?: boolean }) =>
        opts?.forceRefresh ? 'tok2' : 'tok1',
      ),
    };
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return call === 1
        ? jsonResponse({}, 401)
        : jsonResponse({ products: [{ id: '1' }], pagination: { hasNext: false } });
    });
    const client = new RatioProductSourceClient(tokens, {
      baseUrl: 'https://x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const all = await client.fetchAllProducts('m1');

    expect(all.map((p) => p.id)).toEqual(['1']);
    expect(tokens.getAccessToken).toHaveBeenCalledTimes(2);
    const [, retryInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect((retryInit.headers as Record<string, string>).authorization).toBe('Bearer tok2');
  });
});
