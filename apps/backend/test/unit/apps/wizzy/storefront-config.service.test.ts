import { wizzyStorefrontConfigSchema } from '@ratio-app/shared/schemas/wizzy-search';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CryptoService } from '../../../../src/core/crypto/crypto.service';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import type { WizzyConfigRow, WizzyDatabase } from '../../../../src/modules/wizzy/db/types';
import { StorefrontConfigService } from '../../../../src/modules/wizzy/storefront/storefront-config.service';

const MERCHANT_ID = 'm1';

/** A configured row as it would come back from the DB. */
function makeRow(overrides: Partial<WizzyConfigRow> = {}): WizzyConfigRow {
  return {
    merchantId: MERCHANT_ID,
    wizzyEnabled: true,
    storeId: 's1',
    storeSecretEnc: 'enc:secret',
    apiKeyEnc: 'enc:pub',
    sdkUrl: 'https://cdn.wizzy.ai/sdk/v2/wizzy.min.js',
    storeUrl: 'https://example.com',
    scriptTagId: null,
    scriptTagStatus: 'active',
    autoSyncEnabled: true,
    includeOutOfStock: true,
    stripHtmlDescription: true,
    searchEnabled: true,
    inputSelector: '#search',
    resultsMountSelector: '#results',
    resultsPagePath: '/find',
    themePrimary: '#ff0000',
    lastBulkSyncAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as WizzyConfigRow;
}

/** Minimal chainable Kysely mock serving a configurable row. */
function makeHandle(configRow: WizzyConfigRow | undefined) {
  const db = {
    selectFrom(table: string) {
      const chain = {
        selectAll: () => chain,
        select: () => chain,
        where: () => chain,
        limit: () => chain,
        executeTakeFirst: () => Promise.resolve(table === 'wizzy_configs' ? configRow : undefined),
      };
      return chain;
    },
  };
  return { db } as unknown as KyselyClient<WizzyDatabase>;
}

/** Fake crypto whose `decrypt` reverses the `enc:` prefix from `encrypt`. */
function makeCrypto(): CryptoService {
  return {
    encrypt: (s: string) => `enc:${s}`,
    decrypt: (s: string) => s.replace(/^enc:/, ''),
  } as unknown as CryptoService;
}

describe('StorefrontConfigService', () => {
  let crypto: CryptoService;

  beforeEach(() => {
    crypto = makeCrypto();
  });

  it('returns a redacted public config with the decrypted apiKey', async () => {
    const service = new StorefrontConfigService(makeHandle(makeRow()), crypto);

    const result = await service.publicConfig(MERCHANT_ID);

    expect(result.storeId).toBe('s1');
    expect(result.apiKey).toBe('pub'); // DECRYPTED
    expect(result.searchEnabled).toBe(true);
    expect(result.inputSelector).toBe('#search');
    expect(result.resultsMountSelector).toBe('#results');
    expect(result.resultsPagePath).toBe('/find');
    expect(result.theme).toEqual({ primary: '#ff0000' });
    expect(typeof result.version).toBe('string');
    expect(result.version.length).toBeGreaterThan(0);

    // No secrets leak.
    expect(result).not.toHaveProperty('storeSecret');
    expect(result).not.toHaveProperty('storeSecretEnc');
    expect(result).not.toHaveProperty('apiKeyEnc');
    expect(JSON.stringify(result)).not.toContain('enc:');
    expect(JSON.stringify(result)).not.toContain('secret');

    // Proves it conforms to the strict public schema.
    expect(() => wizzyStorefrontConfigSchema.parse(result)).not.toThrow();
  });

  it('returns searchEnabled=false when the row has searchEnabled=0', async () => {
    const service = new StorefrontConfigService(
      makeHandle(makeRow({ searchEnabled: 0 as unknown as boolean })),
      crypto,
    );

    const result = await service.publicConfig(MERCHANT_ID);

    expect(result.searchEnabled).toBe(false);
    expect(result.storeId).toBe('s1');
    expect(() => wizzyStorefrontConfigSchema.parse(result)).not.toThrow();
  });

  it('returns a safe disabled config when the row is missing', async () => {
    const service = new StorefrontConfigService(makeHandle(undefined), crypto);

    const result = await service.publicConfig(MERCHANT_ID);

    expect(result.searchEnabled).toBe(false);
    expect(result.storeId).toBe('');
    expect(result.apiKey).toBe('');
    expect(() => wizzyStorefrontConfigSchema.parse(result)).not.toThrow();
  });

  it('returns a safe disabled config when storeId/apiKeyEnc is null (not configured)', async () => {
    const service = new StorefrontConfigService(
      makeHandle(makeRow({ storeId: null, apiKeyEnc: null })),
      crypto,
    );

    const result = await service.publicConfig(MERCHANT_ID);

    expect(result.searchEnabled).toBe(false);
    expect(result.apiKey).toBe('');
    expect(JSON.stringify(result)).not.toContain('enc:');
    expect(() => wizzyStorefrontConfigSchema.parse(result)).not.toThrow();
  });
});
