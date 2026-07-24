import { describe, it, expect, vi } from 'vitest';
import { RpProductsService } from './products.service';
import type { RpRatioClientService } from '../ratio-client/ratio-client.service';
import type { RpTransformerService } from '../transformer/transformer.service';
import type { RpIdMappingService } from '../id-mapping/id-mapping.service';

/**
 * RP hands back a hashed product_id (id-mapping/hash-id.ts) when it requests a product —
 * e.g. during a return/exchange's original-product validation (`GET /rp/shopify/products/:id`).
 * OS Item Service only understands the real OS ID, so the adapter must reverse the hash via
 * ratio-apps' own id-mapping table (never RP's MongoDB — see migration 0003).
 */
function makeService(opts: {
  resolvedRealId?: string | null;
  getProduct?: ReturnType<typeof vi.fn>;
}) {
  const resolveRealId = vi.fn().mockResolvedValue(opts.resolvedRealId ?? null);
  const hashAndPersist = vi.fn().mockResolvedValue('hashed');
  const ratioClient = {
    getProduct: opts.getProduct ?? vi.fn().mockResolvedValue({ product: { id: 'real-os-id' } }),
  } as unknown as RpRatioClientService;
  const transformer = {
    shopifyProduct: vi.fn((p: unknown) => p),
  } as unknown as RpTransformerService;
  const idMapping = { resolveRealId, hashAndPersist } as unknown as RpIdMappingService;

  const service = new RpProductsService(ratioClient, transformer, idMapping);
  return { service, ratioClient, resolveRealId, hashAndPersist };
}

describe('RpProductsService.getProduct — hashed product ID resolution', () => {
  it('resolves the hashed product_id via the id-mapping table before calling OS Item Service', async () => {
    const { service, ratioClient, resolveRealId } = makeService({
      resolvedRealId: '17720223476919127',
    });

    await service.getProduct('m1', 'shop.example', '1107513967307445');

    expect(resolveRealId).toHaveBeenCalledWith('product', '1107513967307445');
    expect(ratioClient.getProduct).toHaveBeenCalledWith('m1', 'shop.example', '17720223476919127');
  });

  it('restores the hashed ID on the response so RP keeps matching its own cache', async () => {
    const { service } = makeService({
      resolvedRealId: '17720223476919127',
      getProduct: vi.fn().mockResolvedValue({ product: { id: 'real-os-id', title: 'Widget' } }),
    });

    const result = (await service.getProduct('m1', 'shop.example', '1107513967307445')) as {
      product: { id: unknown };
    };

    expect(result.product.id).toBe(1107513967307445);
  });

  it('falls back to the hashed ID when no mapping is found (reproduces the pre-fix REQUEST_EXCHANGE_E4 case)', async () => {
    const { service, ratioClient } = makeService({ resolvedRealId: null });

    await service.getProduct('m1', 'shop.example', '1107513967307445');

    expect(ratioClient.getProduct).toHaveBeenCalledWith('m1', 'shop.example', '1107513967307445');
  });
});

// RP's exchange-reserve flow (return_prime_public's reserveExchangeInventoryOnShopify)
// reads a variant's inventory_item_id straight off its cached product object and later
// round-trips it back to /rp/shopify/inventory_levels/adjust, which resolves it via this
// same id-mapping table. Without persisting here, a product RP only learned about via a
// direct GET (not a product-create/update webhook, which already persists) would have no
// mapping row to resolve — the adjust call would silently operate on the wrong variant.
describe('RpProductsService.getProduct — variant id mapping persistence', () => {
  it('persists a hash mapping for every variant on the fetched product', async () => {
    const { service, hashAndPersist } = makeService({
      getProduct: vi.fn().mockResolvedValue({
        product: {
          id: 'real-os-id',
          variants: [{ id: 'variant-real-1' }, { id: 'variant-real-2' }],
        },
      }),
    });

    await service.getProduct('m1', 'shop.example', 'hashed-product-id');

    expect(hashAndPersist).toHaveBeenCalledWith('variant', 'variant-real-1');
    expect(hashAndPersist).toHaveBeenCalledWith('variant', 'variant-real-2');
  });

  it('does nothing when the product has no variants array', async () => {
    const { service, hashAndPersist } = makeService({
      getProduct: vi.fn().mockResolvedValue({ product: { id: 'real-os-id' } }),
    });

    await service.getProduct('m1', 'shop.example', 'hashed-product-id');

    expect(hashAndPersist).not.toHaveBeenCalled();
  });

  it('skips variants with a null/undefined id', async () => {
    const { service, hashAndPersist } = makeService({
      getProduct: vi.fn().mockResolvedValue({
        product: { id: 'real-os-id', variants: [{ id: null }, { id: 'variant-real-1' }] },
      }),
    });

    await service.getProduct('m1', 'shop.example', 'hashed-product-id');

    expect(hashAndPersist).toHaveBeenCalledTimes(1);
    expect(hashAndPersist).toHaveBeenCalledWith('variant', 'variant-real-1');
  });
});
