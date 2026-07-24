import { afterEach, describe, expect, it, vi } from 'vitest';
import { RpWebhooksService } from './webhooks.service';
import type { RpMerchantsService } from '../merchants/merchants.service';
import type { RpTransformerService } from '../transformer/transformer.service';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import type { RpOrderSyncService } from '../orders/order-sync.service';
import type { RpIdMappingService } from '../id-mapping/id-mapping.service';

/**
 * Product-create/update webhooks are one of the origin points where a product's hashed id
 * is first minted and shown to RP, independent of any order — must persist the reverse
 * mapping here too so products.controller can later resolve it.
 */
function makeService() {
  const hashAndPersist = vi.fn().mockResolvedValue('irrelevant');
  const merchants = {
    findByMerchantId: vi.fn().mockResolvedValue({ merchantId: 'm1', domain: 'shop.example' }),
  } as unknown as RpMerchantsService;
  const transformer = {
    shopifyProduct: vi.fn((p: unknown) => p),
  } as unknown as RpTransformerService;
  const config = {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'RP_BASE_URL') return 'https://rp.example';
      if (key === 'OS_RP_TOKEN') return 'token';
      return undefined;
    }),
  } as unknown as ConfigService<Env, true>;
  const orderSync = {} as unknown as RpOrderSyncService;
  const idMapping = { hashAndPersist } as unknown as RpIdMappingService;

  const service = new RpWebhooksService(merchants, transformer, config, orderSync, idMapping);
  return { service, hashAndPersist };
}

describe('RpWebhooksService.handleProductCreate/handleProductUpdate — id-mapping persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists the product mapping and each variant mapping before forwarding to RP', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { service, hashAndPersist } = makeService();

    await service.handleProductCreate('m1', {
      id: '17720223476919127',
      variants: [{ id: '1780327220438871' }, { id: '1780327220438872' }],
    });

    expect(hashAndPersist).toHaveBeenCalledWith('product', '17720223476919127');
    expect(hashAndPersist).toHaveBeenCalledWith('variant', '1780327220438871');
    expect(hashAndPersist).toHaveBeenCalledWith('variant', '1780327220438872');
  });

  it('skips product/variant persistence gracefully when the body has no id at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { service, hashAndPersist } = makeService();

    await service.handleProductUpdate('m1', {});

    expect(hashAndPersist).not.toHaveBeenCalled();
  });
});
