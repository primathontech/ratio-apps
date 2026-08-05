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
  it('returns an empty list without calling fetch when no storefront URL is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const client = new FbtOsStorefrontClient(undefined);
    await expect(client.listCollections('m-1', { page: 1, limit: 10 })).resolves.toEqual([]);
    // Pins the short-circuit itself: if the `if (!this.baseUrl) return []`
    // guard were deleted, `this.baseUrl.replace(...)` would throw on
    // `undefined` and the outer catch would still yield `[]` — so a bare
    // `resolves.toEqual([])` here would pass either way and prove nothing.
    // Asserting fetch was never called proves the guard fired BEFORE any
    // request was attempted.
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
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

  it('degrades to an empty list when the body is valid JSON of the wrong shape', async () => {
    // Unlike the '<html>' case above (non-JSON text, caught by res.json()
    // throwing before the schema check runs), this body IS valid JSON — so
    // this is the only test that actually exercises the `!parsed.success`
    // branch and the 'collections' in data discrimination, rather than the
    // outer catch.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ foo: 'bar' }), { status: 200 })),
    );

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

  it('degrades to an empty list when the storefront service times out', async () => {
    // A fetch mock that only settles when the passed-in AbortSignal fires —
    // this mirrors what real fetch does internally, so this test genuinely
    // drives the client's own AbortController/timeout logic rather than
    // resolving on its own. NOTE: a bare `new Promise(() => {})` here would
    // NOT work — nothing links an AbortSignal to an arbitrary promise except
    // code that explicitly listens for it (verified: without the
    // `addEventListener('abort', ...)` below, aborting the controller does
    // not settle the promise, and the test just hangs to a timeout instead of
    // exercising the degrade-to-[] path).
    //
    // Passing `20` as the constructor's timeoutMs override means the
    // client's own AbortController fires in ~20ms instead of the real 5s
    // production default, so this test costs milliseconds, not seconds.
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }),
    );

    await expect(
      new FbtOsStorefrontClient('https://os.example', 20).listCollections('m-1', {
        page: 1,
        limit: 10,
      }),
    ).resolves.toEqual([]);

    vi.unstubAllGlobals();
  });

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
