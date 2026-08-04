import { describe, expect, it, vi } from 'vitest';
import { UcCatalogService } from '../../../../src/modules/unicommerce/services/catalog.service';
import type { UcRatioApiService } from '../../../../src/modules/unicommerce/services/uc-ratio-api.service';

describe('UcCatalogService.list', () => {
  it('maps a Ratio product/variant to the Unicommerce contract shape', async () => {
    const ratio = {
      listProducts: vi.fn().mockResolvedValue([
        {
          id: 'p1',
          title: 'Whey Protein',
          vendor: 'Ratio Nutrition',
          handle: 'whey-protein',
          status: 'active',
          published_at: '2026-01-01T00:00:00Z',
          variants: [
            {
              id: 'v1',
              title: '1kg',
              sku: 'WHEY-1KG',
              imageUrl: 'https://example.com/whey.jpg',
              price: 1999,
              compareAtPrice: 2499,
              cost_per_item: 900,
            },
          ],
        },
      ]),
    };
    const svc = new UcCatalogService(
      ratio as unknown as UcRatioApiService,
      'https://merchant.storefront.com',
    );

    const [product] = await svc.list('m1', 1);

    expect(ratio.listProducts).toHaveBeenCalledWith('m1', { offset: 0, limit: 50 });
    expect(product.id).toBe('p1');
    expect(product.parentTitle).toBe('Whey Protein');
    expect(product.brand).toBe('Ratio Nutrition');
    expect(product.variants[0].variantId).toBe('v1');
    expect(product.variants[0].productUrl).toBe(
      'https://merchant.storefront.com/products/whey-protein',
    );
    expect(product.variants[0].live).toBe(true);
    expect(product.variants[0].itemPrice).toEqual({
      currency: 'INR',
      listingPrice: 1999,
      mrp: 2499,
      msp: 900,
      netSellerPayable: 1099,
    });
  });

  it("translates Unicommerce's 1-indexed pageNumber into the correct Ratio-facing offset", async () => {
    const ratio = { listProducts: vi.fn().mockResolvedValue([]) };
    const svc = new UcCatalogService(
      ratio as unknown as UcRatioApiService,
      'https://merchant.storefront.com',
    );

    await svc.list('m1', 1);
    await svc.list('m1', 2);
    await svc.list('m1', 3);

    expect(ratio.listProducts).toHaveBeenNthCalledWith(1, 'm1', { offset: 0, limit: 50 });
    expect(ratio.listProducts).toHaveBeenNthCalledWith(2, 'm1', { offset: 50, limit: 50 });
    expect(ratio.listProducts).toHaveBeenNthCalledWith(3, 'm1', { offset: 100, limit: 50 });
  });
});

describe('UcCatalogService.count', () => {
  it('walks offset by 50 until a short page, summing variant counts (not undercounting on a full page)', async () => {
    const fullPage = Array.from({ length: 50 }, (_, i) => ({
      id: `p${i}`,
      title: 't',
      vendor: 'v',
      handle: 'h',
      status: 'active',
      published_at: '2026-01-01T00:00:00Z',
      variants: [{ id: 'v1', title: 't', sku: 's', imageUrl: null, price: 1, compareAtPrice: null, cost_per_item: null }],
    }));
    const shortPage = fullPage.slice(0, 3);
    const ratio = {
      listProducts: vi
        .fn()
        .mockResolvedValueOnce(fullPage)
        .mockResolvedValueOnce(shortPage),
    };
    const svc = new UcCatalogService(
      ratio as unknown as UcRatioApiService,
      'https://merchant.storefront.com',
    );

    const total = await svc.count('m1');

    expect(ratio.listProducts).toHaveBeenNthCalledWith(1, 'm1', { offset: 0, limit: 50 });
    expect(ratio.listProducts).toHaveBeenNthCalledWith(2, 'm1', { offset: 50, limit: 50 });
    expect(ratio.listProducts).toHaveBeenCalledTimes(2);
    expect(total).toBe(53);
  });
});
