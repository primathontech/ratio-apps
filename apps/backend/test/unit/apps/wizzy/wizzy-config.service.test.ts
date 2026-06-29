import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CryptoService } from '../../../../src/core/crypto/crypto.service';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import { WizzyConfigService } from '../../../../src/modules/wizzy/config/config.service';
import type { WizzyConfigRow, WizzyDatabase } from '../../../../src/modules/wizzy/db/types';

const MERCHANT_ID = 'merchant-1';

/** A row as it would come back from the DB after an upsert. */
function makeRow(overrides: Partial<WizzyConfigRow> = {}): WizzyConfigRow {
  return {
    merchantId: MERCHANT_ID,
    wizzyEnabled: true,
    storeId: 'store-1',
    storeSecretEnc: 'enc-secret',
    apiKeyEnc: 'enc-key',
    storeUrl: 'https://example.com',
    autoSyncEnabled: true,
    includeOutOfStock: true,
    stripHtmlDescription: true,
    searchEnabled: true,
    inputSelector: '.my-search',
    resultsMountSelector: '#results',
    resultsPagePath: '/find',
    themePrimary: '#ff0000',
    lastBulkSyncAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as WizzyConfigRow;
}

/**
 * Minimal chainable Kysely mock. Captures the values passed to
 * `insertInto(...).values(...)` and serves a configurable row back from
 * `selectFrom(...).executeTakeFirst()`.
 */
function makeHandle(configRow: WizzyConfigRow | undefined, tokenRow: unknown) {
  const captured: { insertValues?: Record<string, unknown> } = {};

  const db = {
    selectFrom(table: string) {
      const chain = {
        selectAll: () => chain,
        select: () => chain,
        where: () => chain,
        limit: () => chain,
        executeTakeFirst: () =>
          Promise.resolve(table === 'wizzy_configs' ? configRow : tokenRow),
      };
      return chain;
    },
    insertInto() {
      const chain = {
        values(v: Record<string, unknown>) {
          captured.insertValues = v;
          return chain;
        },
        onDuplicateKeyUpdate: () => chain,
        execute: () => Promise.resolve([]),
      };
      return chain;
    },
  };

  return {
    handle: { db } as unknown as KyselyClient<WizzyDatabase>,
    captured,
  };
}

function makeCrypto(): CryptoService {
  return {
    encrypt: (s: string) => `enc(${s})`,
    decrypt: (s: string) => s.replace(/^enc\(|\)$/g, ''),
  } as unknown as CryptoService;
}

describe('WizzyConfigService — storefront fields', () => {
  let crypto: CryptoService;

  beforeEach(() => {
    crypto = makeCrypto();
  });

  it('persists the storefront fields on upsert', async () => {
    const { handle, captured } = makeHandle(makeRow(), { merchantId: MERCHANT_ID });
    const service = new WizzyConfigService(handle, crypto);

    await service.upsert(MERCHANT_ID, {
      wizzyEnabled: true,
      autoSyncEnabled: true,
      includeOutOfStock: true,
      stripHtmlDescription: true,
      searchEnabled: true,
      inputSelector: '.my-search',
      resultsMountSelector: '#results',
      resultsPagePath: '/find',
      themePrimary: '#ff0000',
    });

    const v = captured.insertValues ?? {};
    expect(v.searchEnabled).toBe(true);
    expect(v.inputSelector).toBe('.my-search');
    expect(v.resultsMountSelector).toBe('#results');
    expect(v.resultsPagePath).toBe('/find');
    expect(v.themePrimary).toBe('#ff0000');
  });

  it('returns the storefront fields from getByMerchantId / toOutput', async () => {
    const { handle } = makeHandle(makeRow(), { merchantId: MERCHANT_ID });
    const service = new WizzyConfigService(handle, crypto);

    const out = await service.getByMerchantId(MERCHANT_ID);
    expect(out.searchEnabled).toBe(true);
    expect(out.inputSelector).toBe('.my-search');
    expect(out.resultsMountSelector).toBe('#results');
    expect(out.resultsPagePath).toBe('/find');
    expect(out.themePrimary).toBe('#ff0000');
  });

  it('coerces searchEnabled to a boolean', async () => {
    // DB returns TINYINT(1) as 0/1 — must be coerced to a real boolean.
    const { handle } = makeHandle(makeRow({ searchEnabled: 0 as unknown as boolean }), {
      merchantId: MERCHANT_ID,
    });
    const service = new WizzyConfigService(handle, crypto);

    const out = await service.getByMerchantId(MERCHANT_ID);
    expect(out.searchEnabled).toBe(false);
  });

  it('never returns the raw store secret or api key', async () => {
    const { handle } = makeHandle(makeRow(), { merchantId: MERCHANT_ID });
    const service = new WizzyConfigService(handle, crypto);

    const out = await service.getByMerchantId(MERCHANT_ID);
    expect(out).not.toHaveProperty('storeSecretEnc');
    expect(out).not.toHaveProperty('apiKeyEnc');
    expect(JSON.stringify(out)).not.toContain('enc-secret');
    expect(JSON.stringify(out)).not.toContain('enc-key');
    expect(out.hasStoreSecret).toBe(true);
    expect(out.hasApiKey).toBe(true);
  });
});
