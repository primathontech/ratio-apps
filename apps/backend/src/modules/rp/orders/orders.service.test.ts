import { describe, it, expect, vi } from 'vitest';
import { RpOrdersService } from './orders.service';
import type { RpRatioClientService } from '../ratio-client/ratio-client.service';
import type { RpTransformerService } from '../transformer/transformer.service';
import type { RpIdMappingService } from '../id-mapping/id-mapping.service';

/**
 * getOrder/getOrders normalize the OS order (normalize-order.ts hashes each line item's
 * product_id/variant_id and preserves the real os_product_id/os_variant_id alongside them).
 * This is one of the origin points that must persist (hashed -> real) mappings into
 * ratio-apps' own id-mapping table, so products.service.ts can later reverse a hashed id RP
 * sends back.
 */
function makeService(opts: { getOrderResult?: unknown; getOrdersResult?: unknown }) {
  const hashAndPersist = vi.fn().mockResolvedValue('irrelevant');
  const ratioClient = {
    getOrder: vi.fn().mockResolvedValue(opts.getOrderResult),
    getOrders: vi.fn().mockResolvedValue(opts.getOrdersResult),
  } as unknown as RpRatioClientService;
  const transformer = {} as unknown as RpTransformerService;
  const idMapping = { hashAndPersist } as unknown as RpIdMappingService;

  const service = new RpOrdersService(ratioClient, transformer, idMapping);
  return { service, hashAndPersist };
}

// normalizeOrder hashes each line item's raw product_id/variant_id (the real OS ids, as
// OS's own API returns them) into Shopify-shape numeric ids, while preserving the original
// real values as os_product_id/os_variant_id — that's what persistLineItemIdMappings reads.
const orderWithLineItems = (lineItems: unknown[]) => ({
  id: 'ordr_496',
  currency: 'INR',
  line_items: lineItems,
});

describe('RpOrdersService.getOrder — id-mapping persistence', () => {
  it('persists product and variant mappings for every line item that has them', async () => {
    const { service, hashAndPersist } = makeService({
      getOrderResult: {
        order: orderWithLineItems([
          {
            id: 'li_1',
            product_id: '17720225894304237',
            variant_id: '1780327220438871',
          },
        ]),
      },
    });

    await service.getOrder('m1', 'ordr_496');

    expect(hashAndPersist).toHaveBeenCalledWith('product', '17720225894304237');
    expect(hashAndPersist).toHaveBeenCalledWith('variant', '1780327220438871');
  });

  it('skips persistence for line items missing product_id/variant_id', async () => {
    const { service, hashAndPersist } = makeService({
      getOrderResult: { order: orderWithLineItems([{ id: 'li_1' }]) },
    });

    await service.getOrder('m1', 'ordr_496');

    expect(hashAndPersist).not.toHaveBeenCalled();
  });
});

describe('RpOrdersService.getOrders — id-mapping persistence', () => {
  it('persists mappings across every order in the list', async () => {
    const { service, hashAndPersist } = makeService({
      getOrdersResult: {
        orders: [
          orderWithLineItems([{ id: 'li_1', product_id: 'a', variant_id: 'b' }]),
          orderWithLineItems([{ id: 'li_2', product_id: 'c', variant_id: 'd' }]),
        ],
      },
    });

    await service.getOrders('m1', {});

    expect(hashAndPersist).toHaveBeenCalledWith('product', 'a');
    expect(hashAndPersist).toHaveBeenCalledWith('product', 'c');
    expect(hashAndPersist).toHaveBeenCalledWith('variant', 'b');
    expect(hashAndPersist).toHaveBeenCalledWith('variant', 'd');
  });
});
