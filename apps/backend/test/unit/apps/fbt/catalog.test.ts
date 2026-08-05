import { describe, expect, it, vi } from 'vitest';
import { FbtOsStorefrontClient } from '../../../../src/modules/fbt/catalog/os-storefront.client';
import { FbtRatioProductsService } from '../../../../src/modules/fbt/catalog/ratio-products.service';

function fakeRatio(payload: unknown) {
  const requests: Array<{ path: string; opts: unknown }> = [];
  const ratio = {
    async request(path: string, _schema: unknown, opts: unknown) {
      requests.push({ path, opts });
      return payload;
    },
  } as never;
  return { ratio, requests };
}

const TOKEN_PROVIDER = { getAccessToken: async () => 'tok-123' } as never;

describe('FbtRatioProductsService', () => {
  it('calls the doubled-v1 products path the rest of the monorepo uses', async () => {
    const { ratio, requests } = fakeRatio({ data: { products: [] } });
    await new FbtRatioProductsService(ratio, TOKEN_PROVIDER).search('m-1', {
      page: 1,
      limit: 20,
    });

    // Verified against wizzy/google/meta/loyalty: the live gateway path is
    // /api/v1/v1/products, even though the docs say /api/v1/products. Anchored
    // to the path start (rather than a bare `toContain`) so a longer path that
    // merely happens to embed this substring later on would not pass.
    expect(requests[0]?.path.startsWith('/api/v1/v1/products')).toBe(true);
  });

  it('sends the merchant access token as a bearer credential', async () => {
    const { ratio, requests } = fakeRatio({ data: { products: [] } });
    await new FbtRatioProductsService(ratio, TOKEN_PROVIDER).search('m-1', {
      page: 1,
      limit: 20,
    });

    expect(requests[0]?.opts).toMatchObject({ accessToken: 'tok-123' });
  });

  it('forwards the search term and paging', async () => {
    const { ratio, requests } = fakeRatio({ data: { products: [] } });
    await new FbtRatioProductsService(ratio, TOKEN_PROVIDER).search('m-1', {
      search: 'shoe',
      page: 3,
      limit: 50,
    });

    expect(requests[0]?.path).toContain('search=shoe');
    expect(requests[0]?.path).toContain('page=3');
    expect(requests[0]?.path).toContain('limit=50');
  });

  it('normalises a product to the picker shape', async () => {
    const { ratio } = fakeRatio({
      data: {
        products: [
          {
            id: 'p-1',
            title: 'Shoe',
            handle: 'shoe',
            price: 4999,
            images: [{ src: 'https://cdn/x.jpg' }],
          },
        ],
      },
    });
    const out = await new FbtRatioProductsService(ratio, TOKEN_PROVIDER).search('m-1', {
      page: 1,
      limit: 20,
    });

    expect(out.items).toEqual([
      { id: 'p-1', title: 'Shoe', handle: 'shoe', imageUrl: 'https://cdn/x.jpg', price: 4999 },
    ]);
  });

  it('tolerates a product with no images or price', async () => {
    const { ratio } = fakeRatio({ data: { products: [{ id: 'p-2', title: 'Bare' }] } });
    const out = await new FbtRatioProductsService(ratio, TOKEN_PROVIDER).search('m-1', {
      page: 1,
      limit: 20,
    });

    expect(out.items[0]).toEqual({
      id: 'p-2',
      title: 'Bare',
      handle: null,
      imageUrl: null,
      price: null,
    });
  });
});

describe('FbtOsStorefrontClient', () => {
  it('returns an empty list when no storefront URL is configured', async () => {
    const client = new FbtOsStorefrontClient(undefined);
    await expect(client.listCollections('m-1', { page: 1, limit: 10 })).resolves.toEqual([]);
  });

  it('sends gk-merchant-id and NO Authorization header', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: { collections: [] } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await new FbtOsStorefrontClient('https://os.example').listCollections('m-1', {
      page: 1,
      limit: 10,
    });

    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<
      string,
      string
    >;
    // Assert against the ACTUAL headers object passed to fetch, keyed exactly
    // as the client wrote it, plus a lowercase scan for good measure.
    expect(headers['gk-merchant-id']).toBe('m-1');
    expect(headers.authorization).toBeUndefined();
    // This service is unauthenticated and cross-service; leaking the merchant's
    // Ratio OAuth token to it would widen the token's blast radius for no gain.
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');

    vi.unstubAllGlobals();
  });

  it('builds the documented collections query', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: { collections: [] } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await new FbtOsStorefrontClient('https://os.example').listCollections('m-1', {
      search: 'summer',
      page: 2,
      limit: 25,
    });

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/api/v1/collections');
    expect(url).toContain('storeId=m-1');
    expect(url).toContain('page=2');
    expect(url).toContain('limit=25');
    expect(url).toContain('search=summer');

    vi.unstubAllGlobals();
  });

  it('degrades to an empty list when the storefront service errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));

    // One unauthenticated third-party service being down must not take out the
    // whole bundle editor — the merchant just sees no collections to pick.
    await expect(
      new FbtOsStorefrontClient('https://os.example').listCollections('m-1', {
        page: 1,
        limit: 10,
      }),
    ).resolves.toEqual([]);

    vi.unstubAllGlobals();
  });

  it('degrades to an empty list when the response body is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));

    await expect(
      new FbtOsStorefrontClient('https://os.example').listCollections('m-1', {
        page: 1,
        limit: 10,
      }),
    ).resolves.toEqual([]);

    vi.unstubAllGlobals();
  });

  it('degrades to an empty list when fetch throws (network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    await expect(
      new FbtOsStorefrontClient('https://os.example').listCollections('m-1', {
        page: 1,
        limit: 10,
      }),
    ).resolves.toEqual([]);

    vi.unstubAllGlobals();
  });

  it('degrades to an empty list when the request times out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }),
    );

    await expect(
      new FbtOsStorefrontClient('https://os.example').listCollections('m-1', {
        page: 1,
        limit: 10,
      }),
    ).resolves.toEqual([]);

    vi.unstubAllGlobals();
  }, 10_000);

  it('normalises collections to the picker shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: { collections: [{ id: 'c-1', title: 'Summer', handle: 'summer' }] },
            }),
            { status: 200 },
          ),
      ),
    );

    const out = await new FbtOsStorefrontClient('https://os.example').listCollections('m-1', {
      page: 1,
      limit: 10,
    });
    expect(out).toEqual([{ id: 'c-1', title: 'Summer', handle: 'summer' }]);

    vi.unstubAllGlobals();
  });
});
