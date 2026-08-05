import { describe, expect, it } from 'vitest';
import { FbtRatioCollectionsService } from '../../../../src/modules/fbt/catalog/ratio-collections.service';
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

describe('FbtRatioCollectionsService', () => {
  it('calls the doubled-v1 collections path the rest of the monorepo uses', async () => {
    const { ratio, requests } = fakeRatio({ data: { collections: [] } });
    await new FbtRatioCollectionsService(ratio, TOKEN_PROVIDER).list('m-1', {
      page: 1,
      limit: 20,
    });

    // Anchored to the path start (rather than a bare `toContain`) so a
    // single-`v1` regression — or a longer path that merely happens to embed
    // this substring later on — would not pass.
    expect(requests[0]?.path.startsWith('/api/v1/v1/collections')).toBe(true);
  });

  it('sends the merchant access token as a bearer credential', async () => {
    const { ratio, requests } = fakeRatio({ data: { collections: [] } });
    await new FbtRatioCollectionsService(ratio, TOKEN_PROVIDER).list('m-1', {
      page: 1,
      limit: 20,
    });

    // Exact equality (not `toMatchObject`): `opts` is exactly `{ accessToken }`
    // in this service, so this fails both if the token were omitted AND if an
    // unexpected extra field leaked in.
    expect(requests[0]?.opts).toEqual({ accessToken: 'tok-123' });
  });

  it('sends the four confirmed query params with the documented defaults', async () => {
    const { ratio, requests } = fakeRatio({ data: { collections: [] } });
    await new FbtRatioCollectionsService(ratio, TOKEN_PROVIDER).list('m-1', {
      page: 2,
      limit: 15,
    });

    expect(requests[0]?.path).toContain('page=2');
    expect(requests[0]?.path).toContain('limit=15');
    expect(requests[0]?.path).toContain('published=true');
    expect(requests[0]?.path).toContain('includeProducts=false');
  });

  it('honours an explicit published: false rather than falling back to the true default', async () => {
    // Guards the `??` vs `||` distinction: `opts.published || true` would
    // silently turn an explicit `false` back into `true`. Only `??` gets this
    // right, and only a literal `false` input exercises the difference.
    const { ratio, requests } = fakeRatio({ data: { collections: [] } });
    await new FbtRatioCollectionsService(ratio, TOKEN_PROVIDER).list('m-1', {
      page: 1,
      limit: 20,
      published: false,
    });

    expect(requests[0]?.path).toContain('published=false');
  });

  it('normalises a collection to the picker shape', async () => {
    const { ratio } = fakeRatio({
      data: { collections: [{ id: 'c-1', title: 'Summer', handle: 'summer' }] },
    });
    const out = await new FbtRatioCollectionsService(ratio, TOKEN_PROVIDER).list('m-1', {
      page: 1,
      limit: 20,
    });

    expect(out.items).toEqual([{ id: 'c-1', title: 'Summer', handle: 'summer' }]);
  });

  it('tolerates a collection with no handle, yielding handle: null', async () => {
    const { ratio } = fakeRatio({ data: { collections: [{ id: 'c-2', title: 'Bare' }] } });
    const out = await new FbtRatioCollectionsService(ratio, TOKEN_PROVIDER).list('m-1', {
      page: 1,
      limit: 20,
    });

    expect(out.items[0]).toEqual({ id: 'c-2', title: 'Bare', handle: null });
  });

  it('coerces a numeric id to a string', async () => {
    const { ratio } = fakeRatio({ data: { collections: [{ id: 42, title: 'Numeric' }] } });
    const out = await new FbtRatioCollectionsService(ratio, TOKEN_PROVIDER).list('m-1', {
      page: 1,
      limit: 20,
    });

    expect(out.items[0]?.id).toBe('42');
    expect(typeof out.items[0]?.id).toBe('string');
  });

  it('getById hits the single-collection path with the id encoded, and passes includeProducts', async () => {
    const { ratio, requests } = fakeRatio({
      data: { id: 'c-3', title: 'Winter', handle: 'winter' },
    });
    await new FbtRatioCollectionsService(ratio, TOKEN_PROVIDER).getById('m-1', 'c 3', {
      includeProducts: true,
    });

    // 'c 3' (with a space) only encodes to 'c%203' if `encodeURIComponent`
    // actually ran — a literal `id` interpolated unencoded would produce
    // 'c 3' instead and fail this `startsWith`.
    expect(requests[0]?.path.startsWith('/api/v1/v1/collections/c%203')).toBe(true);
    expect(requests[0]?.path).toContain('includeProducts=true');
  });

  it('getById defaults includeProducts to false when not passed', async () => {
    const { ratio, requests } = fakeRatio({ data: { id: 'c-4', title: 'Spring' } });
    await new FbtRatioCollectionsService(ratio, TOKEN_PROVIDER).getById('m-1', 'c-4');

    expect(requests[0]?.path).toContain('includeProducts=false');
  });

  it('errors propagate rather than degrading to an empty list', async () => {
    // Pins design decision 2 over the deleted client's contract: the old
    // `FbtOsStorefrontClient` degraded every failure (bad status, malformed
    // body, network error, timeout) to `[]`. This service must NOT do that.
    // Asserting `.rejects` here — rather than `.resolves.toEqual([])` — is
    // what actually pins the new contract: a resolves-based assertion would
    // pass under either the old or the new behaviour and would prove nothing.
    const ratio = {
      async request() {
        throw new Error('ratio upstream error');
      },
    } as never;

    await expect(
      new FbtRatioCollectionsService(ratio, TOKEN_PROVIDER).list('m-1', { page: 1, limit: 20 }),
    ).rejects.toThrow('ratio upstream error');
  });
});
