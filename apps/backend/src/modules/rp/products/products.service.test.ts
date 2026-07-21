import { describe, it, expect, vi } from 'vitest';
import { RpProductsService } from './products.service';
import type { RpRatioClientService } from '../ratio-client/ratio-client.service';
import type { RpTransformerService } from '../transformer/transformer.service';
import type { RpOrderSyncService } from '../orders/order-sync.service';

/**
 * RP hands back a hashed product_id (numericIdFromString(osProductId)) when it
 * requests a product — e.g. during a return/exchange's original-product validation
 * (`GET /rp/shopify/products/:id`). OS Item Service only understands the real OS ID,
 * so the adapter must reverse the hash via RP's own Mongo `orders` collection, where
 * normalize-order.ts preserves `os_product_id` alongside the hashed `product_id`.
 * Without this, RP's REQUEST_EXCHANGE_E4 fires: the adapter calls OS Item Service with
 * the still-hashed ID, gets a 404, and RP concludes the product doesn't exist.
 */
function makeService(opts: {
  findOneResult?: { line_items?: Array<{ os_product_id?: string | null }> } | null;
  dbAvailable?: boolean;
  getProduct?: ReturnType<typeof vi.fn>;
}) {
  const findOne = vi.fn().mockResolvedValue(opts.findOneResult ?? null);
  const collection = vi.fn().mockReturnValue({ findOne });
  const db = opts.dbAvailable === false ? null : { collection };

  const ratioClient = {
    getProduct: opts.getProduct ?? vi.fn().mockResolvedValue({ product: { id: 'real-os-id' } }),
  } as unknown as RpRatioClientService;
  const transformer = {
    shopifyProduct: vi.fn((p: unknown) => p),
  } as unknown as RpTransformerService;
  const orderSync = {
    getDb: vi.fn().mockResolvedValue(db),
  } as unknown as RpOrderSyncService;

  const service = new RpProductsService(ratioClient, transformer, orderSync);
  return { service, ratioClient, findOne, collection };
}

describe('RpProductsService.getProduct — hashed product ID resolution', () => {
  it('resolves the hashed product_id to the real OS ID via Mongo before calling OS Item Service', async () => {
    const { service, ratioClient, findOne } = makeService({
      findOneResult: { line_items: [{ os_product_id: '17720223476919127' }] },
    });

    await service.getProduct('m1', 'shop.example', '1107513967307445');

    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        store: 'shop.example',
        'line_items.product_id': 1107513967307445,
      }),
      expect.anything(),
    );
    expect(ratioClient.getProduct).toHaveBeenCalledWith('m1', 'shop.example', '17720223476919127');
  });

  it('restores the hashed ID on the response so RP keeps matching its own cache', async () => {
    const { service } = makeService({
      findOneResult: { line_items: [{ os_product_id: '17720223476919127' }] },
      getProduct: vi.fn().mockResolvedValue({ product: { id: 'real-os-id', title: 'Widget' } }),
    });

    const result = (await service.getProduct('m1', 'shop.example', '1107513967307445')) as {
      product: { id: unknown };
    };

    expect(result.product.id).toBe(1107513967307445);
  });

  it('falls back to the hashed ID when no order in Mongo has a matching os_product_id (reproduces the pre-fix REQUEST_EXCHANGE_E4 case)', async () => {
    const { service, ratioClient } = makeService({ findOneResult: null });

    await service.getProduct('m1', 'shop.example', '1107513967307445');

    expect(ratioClient.getProduct).toHaveBeenCalledWith('m1', 'shop.example', '1107513967307445');
  });

  it('falls back gracefully when RP_MONGO_URL is not configured (getDb returns null)', async () => {
    const { service, ratioClient } = makeService({ dbAvailable: false });

    await service.getProduct('m1', 'shop.example', '1107513967307445');

    expect(ratioClient.getProduct).toHaveBeenCalledWith('m1', 'shop.example', '1107513967307445');
  });

  it('falls back gracefully when the Mongo lookup itself throws', async () => {
    const ratioClient = {
      getProduct: vi.fn().mockResolvedValue({ product: {} }),
    } as unknown as RpRatioClientService;
    const transformer = { shopifyProduct: vi.fn((p: unknown) => p) } as unknown as RpTransformerService;
    const orderSync = {
      getDb: vi.fn().mockResolvedValue({
        collection: vi.fn().mockReturnValue({ findOne: vi.fn().mockRejectedValue(new Error('mongo down')) }),
      }),
    } as unknown as RpOrderSyncService;
    const service = new RpProductsService(ratioClient, transformer, orderSync);

    await service.getProduct('m1', 'shop.example', '1107513967307445');

    expect(ratioClient.getProduct).toHaveBeenCalledWith('m1', 'shop.example', '1107513967307445');
  });
});
