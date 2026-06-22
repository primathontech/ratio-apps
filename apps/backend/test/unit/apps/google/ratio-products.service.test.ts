import { describe, expect, it, vi } from 'vitest';
import type { RatioClient } from '../../../../src/core/ratio-client/ratio.client';
import { RatioProductsService } from '../../../../src/modules/google/gmc/ratio-products.service';
import type { RatioTokenProvider } from '../../../../src/modules/google/google-oauth/ratio-token.provider';

/** Fake token provider — yields a (refreshed) access token for the merchant. */
function fakeTokens(token: string | (() => Promise<string>)): RatioTokenProvider {
  const getAccessToken = typeof token === 'function' ? vi.fn(token) : vi.fn(async () => token);
  return { getAccessToken } as unknown as RatioTokenProvider;
}

// Shopify-shaped item (the live QA shape) under the `products` envelope key.
const item = (id: string): Record<string, unknown> => ({
  id,
  title: `Product ${id}`,
  status: 'active',
  vendor: 'Brand',
  product_type: 'Apparel',
  variants: [{ id: `v-${id}`, price: 2999, sku: `SKU-${id}`, inventory_quantity: 50 }],
  images: [{ src: `https://cdn.example.com/${id}.jpg` }],
});

describe('RatioProductsService.listAll', () => {
  it('uses all=true and returns the whole catalog in a single call', async () => {
    const request = vi.fn().mockResolvedValue({
      products: [item('p1'), item('p2'), item('p3')],
      pagination: { total: 3, limit: 10, page: 1, totalPages: 1, hasNext: false },
    });
    const svc = new RatioProductsService(fakeTokens('tok'), {
      request,
    } as unknown as RatioClient);

    const products = await svc.listAll('m1');

    expect(request).toHaveBeenCalledTimes(1);
    expect(String(request.mock.calls[0]?.[0])).toContain('all=true');
    expect(products.map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p3']);
    // Prices still paise → rupees.
    expect(products[0].variants[0].price).toBe(29.99);
  });

  it('falls back to OFFSET paging when all=true is ignored (returns one page)', async () => {
    const TOTAL = 25;
    const pageOf = (offset: number): Record<string, unknown>[] => {
      const out: Record<string, unknown>[] = [];
      for (let i = offset; i < Math.min(offset + 10, TOTAL); i++) out.push(item(`p${i}`));
      return out;
    };
    const paths: string[] = [];
    const request = vi.fn().mockImplementation(async (path: string) => {
      paths.push(path);
      // The endpoint ignores `all` and only ever returns the first 10 for it...
      if (path.includes('all=true')) {
        return { products: pageOf(0), pagination: { total: TOTAL, limit: 10 } };
      }
      // ...but honors `offset` for real slicing.
      const offset = Number(/offset=(\d+)/.exec(path)?.[1] ?? '0');
      return { products: pageOf(offset), pagination: { total: TOTAL, limit: 10 } };
    });
    const svc = new RatioProductsService(fakeTokens('tok'), {
      request,
    } as unknown as RatioClient);

    const products = await svc.listAll('m1');

    // 1 all=true call + offset 0/10/20 = 4 calls; deduped to 25 unique products.
    expect(request).toHaveBeenCalledTimes(4);
    expect(paths.some((p) => p.includes('all=true'))).toBe(true);
    expect(paths.filter((p) => p.includes('offset=')).length).toBe(3);
    expect(products).toHaveLength(TOTAL);
    expect(new Set(products.map((p) => p.id)).size).toBe(TOTAL);
  });

  it('propagates the token provider error when the merchant has no token', async () => {
    const request = vi.fn();
    const svc = new RatioProductsService(
      fakeTokens(async () => {
        throw new Error('no Ratio oauth_tokens row for merchant m1');
      }),
      { request } as unknown as RatioClient,
    );
    await expect(svc.listAll('m1')).rejects.toThrow('no Ratio oauth_tokens row');
    expect(request).not.toHaveBeenCalled();
  });
});
