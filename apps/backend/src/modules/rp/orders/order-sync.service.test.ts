import { describe, it, expect, vi } from 'vitest';
import { RpOrderSyncService } from './order-sync.service';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import type { RpIdMappingService } from '../id-mapping/id-mapping.service';

/**
 * upsertOrder is the webhook-driven counterpart to RpOrdersService's getOrder/getOrders —
 * same id-mapping persistence requirement, but it must run even when RP_MONGO_URL is
 * unconfigured (id-mapping is backed by ratio-apps' own DB, not RP's Mongo, so it must not
 * be gated behind Mongo availability — that was the original bug this fixes).
 */
function makeService(opts: { rpMongoUrl?: string | undefined }) {
  const hashAndPersist = vi.fn().mockResolvedValue('irrelevant');
  const idMapping = { hashAndPersist } as unknown as RpIdMappingService;
  const config = {
    get: vi.fn().mockReturnValue(opts.rpMongoUrl),
  } as unknown as ConfigService<Env, true>;

  const service = new RpOrderSyncService(config, idMapping);
  return { service, hashAndPersist };
}

describe('RpOrderSyncService.upsertOrder — id-mapping persistence', () => {
  it('persists product/variant mappings even when RP_MONGO_URL is not configured', async () => {
    const { service, hashAndPersist } = makeService({ rpMongoUrl: undefined });

    await service.upsertOrder(
      {
        id: 'ordr_496',
        currency: 'INR',
        line_items: [{ id: 'li_1', product_id: '17720225894304237', variant_id: '1780327220438871' }],
      },
      'shop.example',
    );

    expect(hashAndPersist).toHaveBeenCalledWith('product', '17720225894304237');
    expect(hashAndPersist).toHaveBeenCalledWith('variant', '1780327220438871');
  });

  it('skips entirely (no persistence attempted) when the order has no numeric id after normalization', async () => {
    const { service, hashAndPersist } = makeService({ rpMongoUrl: undefined });

    await service.upsertOrder({ id: '', currency: 'INR', line_items: [] }, 'shop.example');

    expect(hashAndPersist).not.toHaveBeenCalled();
  });
});
