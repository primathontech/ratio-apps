import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import { LoyaltyConfigService } from '../../../../src/modules/loyalty/config/config.service';
import type { LoyaltyConfigRow, LoyaltyDatabase } from '../../../../src/modules/loyalty/db/types';

const MERCHANT_ID = 'merchant-1';

/** Stub StorefrontConfigService — upsert calls `.invalidate()` to bust the cache. */
// biome-ignore lint/suspicious/noExplicitAny: minimal stub, no type import needed
const fakeStorefrontConfig: any = { invalidate: async () => {} };

/** A row as it would come back from the DB. */
function makeRow(overrides: Partial<LoyaltyConfigRow> = {}): LoyaltyConfigRow {
  return {
    merchantId: MERCHANT_ID,
    programName: 'Coins',
    baseEarnRate: '1' as unknown as number, // DECIMAL comes back as a string from mysql2.
    coinValueInr: '0.1' as unknown as number,
    storefrontBaseUrl: null,
    exportEmail: null,
    claimSigningSecret: 'existing-secret',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as LoyaltyConfigRow;
}

/**
 * Minimal chainable Kysely mock. Serves a configurable `loyalty_configs` row
 * from `selectFrom(...).selectAll()/.select(...).executeTakeFirst()` and
 * captures the values passed to `updateTable(...).set(...)`.
 */
function makeHandle(configRow: LoyaltyConfigRow | undefined) {
  const updates: Record<string, unknown>[] = [];

  const db = {
    selectFrom(table: string) {
      const chain = {
        selectAll: () => chain,
        select: () => chain,
        where: () => chain,
        limit: () => chain,
        executeTakeFirst: () =>
          Promise.resolve(table === 'loyalty_configs' ? configRow : undefined),
      };
      return chain;
    },
    updateTable(_table: string) {
      const chain = {
        set: (v: Record<string, unknown>) => {
          updates.push(v);
          return chain;
        },
        where: () => chain,
        execute: () => Promise.resolve([{ numUpdatedRows: 1n }]),
      };
      return chain;
    },
  };

  return {
    handle: { db } as unknown as KyselyClient<LoyaltyDatabase>,
    updates,
  };
}

describe('LoyaltyConfigService — claim secret reveal/rotate', () => {
  it('getClaimSecret returns the stored secret', async () => {
    const { handle } = makeHandle(makeRow({ claimSigningSecret: 'stored-secret' }));
    const service = new LoyaltyConfigService(handle, fakeStorefrontConfig);

    await expect(service.getClaimSecret(MERCHANT_ID)).resolves.toEqual({
      secret: 'stored-secret',
    });
  });

  it('getClaimSecret 404s when the merchant has no config row', async () => {
    const { handle } = makeHandle(undefined);
    const service = new LoyaltyConfigService(handle, fakeStorefrontConfig);

    await expect(service.getClaimSecret(MERCHANT_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getClaimSecret 404s when the row has no secret', async () => {
    const { handle } = makeHandle(makeRow({ claimSigningSecret: null }));
    const service = new LoyaltyConfigService(handle, fakeStorefrontConfig);

    await expect(service.getClaimSecret(MERCHANT_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rotateClaimSecret writes a new 32-byte base64 secret and returns it', async () => {
    const { handle, updates } = makeHandle(makeRow());
    const service = new LoyaltyConfigService(handle, fakeStorefrontConfig);

    const { secret } = await service.rotateClaimSecret(MERCHANT_ID);

    expect(Buffer.from(secret, 'base64')).toHaveLength(32);
    expect(updates[0]?.claimSigningSecret).toBe(secret);
  });

  it('rotateClaimSecret returns a different secret than the one stored before', async () => {
    const { handle } = makeHandle(makeRow({ claimSigningSecret: 'old-secret' }));
    const service = new LoyaltyConfigService(handle, fakeStorefrontConfig);

    const { secret } = await service.rotateClaimSecret(MERCHANT_ID);

    expect(secret).not.toBe('old-secret');
  });

  it('getByMerchantId reports claimSecretSet=true but never the raw secret', async () => {
    const { handle } = makeHandle(makeRow({ claimSigningSecret: 'super-secret-value' }));
    const service = new LoyaltyConfigService(handle, fakeStorefrontConfig);

    const out = await service.getByMerchantId(MERCHANT_ID);

    expect(out.claimSecretSet).toBe(true);
    expect(out).not.toHaveProperty('claimSigningSecret');
    expect(JSON.stringify(out)).not.toContain('super-secret-value');
  });

  it('getByMerchantId reports claimSecretSet=false when the row has no secret', async () => {
    const { handle } = makeHandle(makeRow({ claimSigningSecret: null }));
    const service = new LoyaltyConfigService(handle, fakeStorefrontConfig);

    const out = await service.getByMerchantId(MERCHANT_ID);

    expect(out.claimSecretSet).toBe(false);
  });
});
