import { loyaltyPublicConfigSchema } from '@ratio-app/shared/schemas/loyalty-claim';
import type { Selectable } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import type { LoyaltyDatabase } from '../../../../src/modules/loyalty/db/types';
import { StorefrontConfigService } from '../../../../src/modules/loyalty/storefront/storefront-config.service';

type LoyaltyConfigRow = Selectable<LoyaltyDatabase['loyalty_configs']>;

const MERCHANT_ID = 'm1';
const SECRET = 'super-secret-signing-key-base64==';

/** A configured row as it would come back from the DB — carries the secret. */
function makeRow(overrides: Partial<LoyaltyConfigRow> = {}): LoyaltyConfigRow {
  return {
    merchantId: MERCHANT_ID,
    programName: 'Wellversed Coins',
    claimSigningSecret: SECRET,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as LoyaltyConfigRow;
}

/**
 * Chainable Kysely mock that HONORS the column projection: `select([...])`
 * returns only those keys (like real SQL), `selectAll()` returns the full row.
 * This is what makes the "no secret in cache" test a genuine regression guard —
 * a regression to `selectAll()` would leak `claimSigningSecret` into the row.
 */
function makeHandle(configRow: LoyaltyConfigRow | undefined) {
  const project = (cols: string[]) =>
    configRow &&
    Object.fromEntries(cols.map((c) => [c, (configRow as Record<string, unknown>)[c]]));
  const db = {
    selectFrom(table: string) {
      let picked: string[] | null = null;
      const chain = {
        selectAll: () => chain,
        select: (cols: string[]) => {
          picked = cols;
          return chain;
        },
        where: () => chain,
        limit: () => chain,
        executeTakeFirst: () =>
          Promise.resolve(
            table !== 'loyalty_configs' ? undefined : picked ? project(picked) : configRow,
          ),
      };
      return chain;
    },
  };
  return { db } as unknown as KyselyClient<LoyaltyDatabase>;
}

/** Fake Redis: miss on read; captures every write so we can inspect it. */
function makeRedis() {
  const setJson = vi.fn(async () => {});
  const redis = {
    getJson: async () => null,
    setJson,
    del: async () => {},
  } as unknown as never;
  return { redis, setJson };
}

describe('loyalty StorefrontConfigService', () => {
  it('returns the redacted public config (programName + enabled + version)', async () => {
    const { redis } = makeRedis();
    const service = new StorefrontConfigService(makeHandle(makeRow()), redis);

    const result = await service.publicConfig(MERCHANT_ID);

    expect(result.programName).toBe('Wellversed Coins');
    expect(result.enabled).toBe(true);
    expect(typeof result.version).toBe('string');
    expect(result.version.length).toBeGreaterThan(0);
    expect(() => loyaltyPublicConfigSchema.parse(result)).not.toThrow();
  });

  it('NEVER writes the claim signing secret into the Redis cache', async () => {
    const { redis, setJson } = makeRedis();
    const service = new StorefrontConfigService(makeHandle(makeRow()), redis);

    await service.publicConfig(MERCHANT_ID);

    expect(setJson).toHaveBeenCalledTimes(1);
    const [, cachedValue] = setJson.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(cachedValue).not.toHaveProperty('claimSigningSecret');
    expect(JSON.stringify(cachedValue)).not.toContain(SECRET);
  });

  it('reports enabled=false and a safe default when the row is missing', async () => {
    const { redis } = makeRedis();
    const service = new StorefrontConfigService(makeHandle(undefined), redis);

    const result = await service.publicConfig(MERCHANT_ID);

    expect(result.enabled).toBe(false);
    expect(result.programName).toBe('Coins');
    expect(() => loyaltyPublicConfigSchema.parse(result)).not.toThrow();
  });
});
