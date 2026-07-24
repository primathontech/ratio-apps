import { describe, it, expect, vi } from 'vitest';
import { RpIdMappingService } from './id-mapping.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { RpDatabase } from '../db/types';
import { hashId } from './hash-id';

function makeHandle(opts: {
  insertExecute?: ReturnType<typeof vi.fn>;
  selectResult?: { realId: string } | undefined;
}) {
  const insertExecute = opts.insertExecute ?? vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({
    onDuplicateKeyUpdate: vi.fn().mockReturnValue({ execute: insertExecute }),
  });
  const insertInto = vi.fn().mockReturnValue({ values });

  const executeTakeFirst = vi.fn().mockResolvedValue(opts.selectResult);
  const where2 = vi.fn().mockReturnValue({ executeTakeFirst });
  const where1 = vi.fn().mockReturnValue({ where: where2 });
  const select = vi.fn().mockReturnValue({ where: where1 });
  const selectFrom = vi.fn().mockReturnValue({ select });

  const db = { insertInto, selectFrom } as unknown as KyselyClient<RpDatabase>['db'];
  return { handle: { db } as KyselyClient<RpDatabase>, insertInto, values, selectFrom, where1, where2 };
}

describe('RpIdMappingService.hashAndPersist', () => {
  it('computes the hash and upserts (entityType, hashedId) -> realId', async () => {
    const { handle, insertInto, values } = makeHandle({});
    const service = new RpIdMappingService(handle);

    const realId = '17720223476919127';
    const result = await service.hashAndPersist('product', realId);

    expect(result).toBe(hashId(realId));
    expect(insertInto).toHaveBeenCalledWith('rp_id_mappings');
    expect(values).toHaveBeenCalledWith({ entityType: 'product', hashedId: result, realId });
  });

  it('short-circuits without touching the DB when the value hashes to "0"', async () => {
    const { handle, insertInto } = makeHandle({});
    const service = new RpIdMappingService(handle);

    const result = await service.hashAndPersist('product', '');

    expect(result).toBe('0');
    expect(insertInto).not.toHaveBeenCalled();
  });

  it('still returns the hash when the DB write throws (never breaks the caller)', async () => {
    const insertExecute = vi.fn().mockRejectedValue(new Error('db down'));
    const { handle } = makeHandle({ insertExecute });
    const service = new RpIdMappingService(handle);

    const realId = '17720223476919127';
    await expect(service.hashAndPersist('product', realId)).resolves.toBe(hashId(realId));
  });
});

describe('RpIdMappingService.resolveRealId', () => {
  it('returns the real id when a mapping exists', async () => {
    const { handle } = makeHandle({ selectResult: { realId: '17720223476919127' } });
    const service = new RpIdMappingService(handle);

    await expect(service.resolveRealId('product', '1107513967307445')).resolves.toBe(
      '17720223476919127',
    );
  });

  it('returns null when no mapping exists', async () => {
    const { handle } = makeHandle({ selectResult: undefined });
    const service = new RpIdMappingService(handle);

    await expect(service.resolveRealId('product', 'unknown')).resolves.toBeNull();
  });

  it('returns null (fails open) when the lookup throws', async () => {
    const handle = {
      db: {
        selectFrom: vi.fn().mockImplementation(() => {
          throw new Error('db down');
        }),
      },
    } as unknown as KyselyClient<RpDatabase>;
    const service = new RpIdMappingService(handle);

    await expect(service.resolveRealId('product', 'x')).resolves.toBeNull();
  });
});
