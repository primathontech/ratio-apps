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
  const ratioClient = {
    getProduct: opts.getProduct ?? vi.fn().mockResolvedValue({ product: { id: 'real-os-id' } }),
  } as unknown as RpRatioClientService;
  const transformer = {
    shopifyProduct: vi.fn((p: unknown) => p),
  } as unknown as RpTransformerService;
  const idMapping = { resolveRealId } as unknown as RpIdMappingService;

  const service = new RpProductsService(ratioClient, transformer, idMapping);
  return { service, ratioClient, resolveRealId };
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
