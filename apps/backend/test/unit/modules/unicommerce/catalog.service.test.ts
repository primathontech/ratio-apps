import { describe, expect, it, vi } from 'vitest';
import { UcCatalogService } from '../../../../src/modules/unicommerce/services/catalog.service';
import type { UcCredentialsService } from '../../../../src/modules/unicommerce/services/credentials.service';
import type { UcRatioApiService } from '../../../../src/modules/unicommerce/services/uc-ratio-api.service';

// Real Ratio API money fields are in paise, and the discount field is
// snake_case `compare_at_price` — both confirmed 2026-08-06 against the live
// API (a catalog variant's `price` matched its order line-item `price`
// exactly, and `compare_at_price`/`inventory_quantity` are the real field
// names, not the camelCase/nested shapes this fixture used to have).
/** A single Ratio product with one variant, reused across the domain tests. */
const productFixture = [
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
        price: 199900, // paise — ₹1999.00
        compare_at_price: 249900, // paise — ₹2499.00
        cost_per_item: 90000, // paise — ₹900.00
        inventory_quantity: 42,
      },
    ],
  },
];

function fakeCredentials(storeDomain: string | null) {
  return { getStoreDomain: vi.fn().mockResolvedValue(storeDomain) };
}

describe('UcCatalogService.list', () => {
  it('maps a Ratio product/variant to the Unicommerce contract shape', async () => {
    const ratio = {
      listProducts: vi.fn().mockResolvedValue(productFixture),
    };
    const credentials = fakeCredentials(null);
    const svc = new UcCatalogService(
      ratio as unknown as UcRatioApiService,
      credentials as unknown as UcCredentialsService,
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
    expect(product.variants[0].inventory).toBe(42);
    // TRD §4.2: "netSellerPayable = listingPrice, all charges = 0 in v1" —
    // commissionPercentage/paymentGatewayCharge/logisticsCost are all fixed 0,
    // so nothing is deducted from what the seller actually receives yet. msp
    // (cost_per_item) is a cost-basis reference, not a platform charge — it
    // must NOT be subtracted here (that would be margin, not seller payout).
    expect(product.variants[0].itemPrice).toEqual({
      currency: 'INR',
      listingPrice: 1999,
      mrp: 2499,
      msp: 900,
      netSellerPayable: 1999,
    });
  });

  it("translates Unicommerce's 1-indexed pageNumber into the correct Ratio-facing offset", async () => {
    const ratio = { listProducts: vi.fn().mockResolvedValue([]) };
    const credentials = fakeCredentials(null);
    const svc = new UcCatalogService(
      ratio as unknown as UcRatioApiService,
      credentials as unknown as UcCredentialsService,
      'https://merchant.storefront.com',
    );

    await svc.list('m1', 1);
    await svc.list('m1', 2);
    await svc.list('m1', 3);

    expect(ratio.listProducts).toHaveBeenNthCalledWith(1, 'm1', { offset: 0, limit: 50 });
    expect(ratio.listProducts).toHaveBeenNthCalledWith(2, 'm1', { offset: 50, limit: 50 });
    expect(ratio.listProducts).toHaveBeenNthCalledWith(3, 'm1', { offset: 100, limit: 50 });
  });

  it("builds productUrl from the merchant's stored storefront domain, not the fallback", async () => {
    const ratio = { listProducts: vi.fn().mockResolvedValue(productFixture) };
    const credentials = fakeCredentials('https://bblunt.com');
    const svc = new UcCatalogService(
      ratio as unknown as UcRatioApiService,
      credentials as unknown as UcCredentialsService,
      'https://fallback.storefront.com',
    );

    const [product] = await svc.list('m1', 1);

    expect(credentials.getStoreDomain).toHaveBeenCalledWith('m1');
    expect(product.variants[0].productUrl).toBe('https://bblunt.com/products/whey-protein');
  });

  it("falls back to the constructor's fallback domain when the merchant has no stored domain", async () => {
    const ratio = { listProducts: vi.fn().mockResolvedValue(productFixture) };
    const credentials = fakeCredentials(null);
    const svc = new UcCatalogService(
      ratio as unknown as UcRatioApiService,
      credentials as unknown as UcCredentialsService,
      'https://fallback.storefront.com',
    );

    const [product] = await svc.list('m1', 1);

    expect(product.variants[0].productUrl).toBe(
      'https://fallback.storefront.com/products/whey-protein',
    );
  });

  it('uses a DIFFERENT stored domain per merchant (proves the one-shared-domain bug is fixed)', async () => {
    const ratio = { listProducts: vi.fn().mockResolvedValue(productFixture) };
    const credentials = {
      getStoreDomain: vi
        .fn()
        .mockResolvedValueOnce('https://bblunt.com')
        .mockResolvedValueOnce('https://wellversed.com'),
    };
    const svc = new UcCatalogService(
      ratio as unknown as UcRatioApiService,
      credentials as unknown as UcCredentialsService,
      'https://fallback.storefront.com',
    );

    const [bbluntProduct] = await svc.list('merchant-bblunt', 1);
    const [wellversedProduct] = await svc.list('merchant-wellversed', 1);

    expect(credentials.getStoreDomain).toHaveBeenNthCalledWith(1, 'merchant-bblunt');
    expect(credentials.getStoreDomain).toHaveBeenNthCalledWith(2, 'merchant-wellversed');
    expect(bbluntProduct.variants[0].productUrl).toBe('https://bblunt.com/products/whey-protein');
    expect(wellversedProduct.variants[0].productUrl).toBe(
      'https://wellversed.com/products/whey-protein',
    );
    expect(bbluntProduct.variants[0].productUrl).not.toBe(wellversedProduct.variants[0].productUrl);
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
      variants: [
        {
          id: 'v1',
          title: 't',
          sku: 's',
          imageUrl: null,
          price: 1,
          compare_at_price: null,
          cost_per_item: null,
        },
      ],
    }));
    const shortPage = fullPage.slice(0, 3);
    const ratio = {
      listProducts: vi.fn().mockResolvedValueOnce(fullPage).mockResolvedValueOnce(shortPage),
    };
    const credentials = fakeCredentials(null);
    const svc = new UcCatalogService(
      ratio as unknown as UcRatioApiService,
      credentials as unknown as UcCredentialsService,
      'https://merchant.storefront.com',
    );

    const total = await svc.count('m1');

    expect(ratio.listProducts).toHaveBeenNthCalledWith(1, 'm1', { offset: 0, limit: 50 });
    expect(ratio.listProducts).toHaveBeenNthCalledWith(2, 'm1', { offset: 50, limit: 50 });
    expect(ratio.listProducts).toHaveBeenCalledTimes(2);
    expect(total).toBe(53);
  });
});
