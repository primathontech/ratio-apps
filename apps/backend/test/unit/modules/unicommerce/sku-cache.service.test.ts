import { describe, expect, it } from 'vitest';
import { UcSkuCacheService } from '../../../../src/modules/unicommerce/services/sku-cache.service';

function fakeDb(row?: { ratioVariantId: string }) {
  return {
    db: {
      selectFrom: () => ({
        selectAll: () => ({
          where: () => ({
            where: () => ({
              executeTakeFirst: async () => row,
            }),
          }),
        }),
      }),
      insertInto: () => ({
        values: () => ({
          onDuplicateKeyUpdate: () => ({ execute: async () => undefined }),
        }),
      }),
    },
  };
}

describe('UcSkuCacheService.resolve', () => {
  it('returns the cached variant_id for a known SKU', async () => {
    const svc = new UcSkuCacheService(fakeDb({ ratioVariantId: 'variant-1' }) as never);
    const result = await svc.resolve('m1', 'SKU-123');
    expect(result).toBe('variant-1');
  });

  it('returns null for an unknown SKU (cache miss, not a thrown error)', async () => {
    const svc = new UcSkuCacheService(fakeDb(undefined) as never);
    const result = await svc.resolve('m1', 'SKU-UNKNOWN');
    expect(result).toBeNull();
  });
});
