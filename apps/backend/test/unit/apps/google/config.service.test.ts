import { NotFoundException } from '@nestjs/common';
import type { GoogleConfigInput } from '@ratio-app/shared/schemas/google-config';
import { describe, expect, it } from 'vitest';
import { CryptoService } from '../../../../src/core/crypto/crypto.service';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import { GoogleConfigService } from '../../../../src/modules/google/config/config.service';
import type { GoogleConfigRow, GoogleDatabase } from '../../../../src/modules/google/db/types';

/**
 * Fake `handle.db` that implements EXACTLY the Kysely chains GoogleConfigService
 * touches, casting through `as unknown as` to satisfy the typed client:
 *
 *   selectFrom('google_configs').selectAll().where().limit().executeTakeFirst()
 *   selectFrom('google_credentials').select([...]).where().limit().executeTakeFirst()
 *   insertInto('google_configs').values().onDuplicateKeyUpdate().execute()
 *
 * Each builder method returns the same chainable object (a `this`-like no-op);
 * the INSERT captures `.values()`/`.onDuplicateKeyUpdate()` into a recorder.
 *
 * The `configRow` holder is mutable: `upsert` re-reads via `getByMerchantId`, so
 * the SELECT reads back whatever the test (or a prior write) placed in `holder`.
 */
function makeFakeHandle(init: {
  /** Row returned by selectFrom('google_configs'); mutate via `holder` for round-trips. */
  configRow?: GoogleConfigRow;
  /** Row returned by selectFrom('google_credentials'). */
  credRow?: { needsReconnect: boolean | number } | undefined;
}): {
  handle: KyselyClient<GoogleDatabase>;
  holder: { row?: GoogleConfigRow };
  recorder: {
    insertedValues?: Record<string, unknown>;
    onDuplicateKeyUpdate?: Record<string, unknown>;
  };
} {
  const holder: { row?: GoogleConfigRow } = { row: init.configRow };
  const recorder: {
    insertedValues?: Record<string, unknown>;
    onDuplicateKeyUpdate?: Record<string, unknown>;
  } = {};

  const configSelectChain = {
    selectAll: () => configSelectChain,
    where: () => configSelectChain,
    limit: () => configSelectChain,
    executeTakeFirst: async () => holder.row,
  };

  const credSelectChain = {
    select: () => credSelectChain,
    where: () => credSelectChain,
    limit: () => credSelectChain,
    executeTakeFirst: async () => init.credRow,
  };

  const insertChain = {
    values: (v: Record<string, unknown>) => {
      recorder.insertedValues = v;
      return insertChain;
    },
    onDuplicateKeyUpdate: (u: Record<string, unknown>) => {
      recorder.onDuplicateKeyUpdate = u;
      return insertChain;
    },
    execute: async () => [],
  };

  const db = {
    selectFrom: (table: string) => {
      if (table === 'google_configs') return configSelectChain;
      if (table === 'google_credentials') return credSelectChain;
      throw new Error(`unexpected selectFrom("${table}")`);
    },
    insertInto: (table: string) => {
      if (table === 'google_configs') return insertChain;
      throw new Error(`unexpected insertInto("${table}")`);
    },
  };

  return {
    handle: { db } as unknown as KyselyClient<GoogleDatabase>,
    holder,
    recorder,
  };
}

/** A complete stored row, overridable per-case. */
function makeRow(overrides: Partial<GoogleConfigRow> = {}): GoogleConfigRow {
  return {
    merchantId: 'mer_1',
    connectionMethod: 'manual',
    googleAccountEmail: null,
    ga4Enabled: false,
    ga4MeasurementId: null,
    ga4PixelId: null,
    ga4PixelStatus: 'disabled',
    adsEnabled: false,
    adsConversionId: null,
    adsConversionLabel: null,
    adsPixelId: null,
    adsPixelStatus: 'disabled',
    enhancedConversionsEnabled: false,
    gmcEnabled: false,
    gmcMerchantId: null,
    gmcStoreUrl: null,
    gmcServiceAccountKeyEnc: null,
    gmcTargetCountry: 'IN',
    gmcContentLanguage: 'en',
    gmcCurrency: 'INR',
    gmcDefaultCondition: 'new',
    gmcBrandOverride: null,
    gmcGoogleProductCategory: null,
    gmcCategoryMode: 'default',
    autoSyncEnabled: true,
    hourlyReconcileEnabled: true,
    syncVariantsEnabled: true,
    includeOutOfStock: true,
    freeListingsEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as GoogleConfigRow;
}

/** A complete valid input, overridable per-case. */
function makeInput(overrides: Partial<GoogleConfigInput> = {}): GoogleConfigInput {
  return {
    connectionMethod: 'manual',
    ga4Enabled: false,
    ga4MeasurementId: null,
    adsEnabled: false,
    adsConversionId: null,
    adsConversionLabel: null,
    enhancedConversionsEnabled: true,
    gmcEnabled: false,
    gmcMerchantId: null,
    gmcTargetCountry: 'IN',
    gmcContentLanguage: 'en',
    gmcCurrency: 'INR',
    gmcDefaultCondition: 'new',
    gmcBrandOverride: null,
    gmcGoogleProductCategory: null,
    gmcCategoryMode: 'default',
    autoSyncEnabled: true,
    hourlyReconcileEnabled: true,
    syncVariantsEnabled: true,
    includeOutOfStock: true,
    freeListingsEnabled: true,
    ...overrides,
  };
}

/** Real CryptoService with a deterministic 32-byte key so encrypt/decrypt round-trips. */
const crypto = new CryptoService(Buffer.alloc(32, 7));

describe('GoogleConfigService (AC1: config encrypt + redact)', () => {
  it('upsert encrypts gmcServiceAccountKey (stored ciphertext decrypts back to plaintext)', async () => {
    const plaintext = '{"k":"secret"}';
    const fake = makeFakeHandle({ configRow: makeRow(), credRow: undefined });
    const svc = new GoogleConfigService(fake.handle, crypto);

    await svc.upsert('mer_1', makeInput({ gmcServiceAccountKey: plaintext }));

    const storedEnc = fake.recorder.insertedValues?.gmcServiceAccountKeyEnc as string;
    expect(storedEnc).toBeTypeOf('string');
    // Encrypted at rest, not the plaintext...
    expect(storedEnc).not.toBe(plaintext);
    // ...and a real round-trip recovers the original.
    expect(crypto.decrypt(storedEnc)).toBe(plaintext);
    // ODKU set must carry the same encrypted column on update.
    expect(
      crypto.decrypt(fake.recorder.onDuplicateKeyUpdate?.gmcServiceAccountKeyEnc as string),
    ).toBe(plaintext);
  });

  it('get redacts secrets (hasGmcKey:true, no raw key field on the output)', async () => {
    const fake = makeFakeHandle({
      configRow: makeRow({ gmcServiceAccountKeyEnc: crypto.encrypt('{"k":"secret"}') }),
      credRow: undefined,
    });
    const svc = new GoogleConfigService(fake.handle, crypto);

    const out = await svc.getByMerchantId('mer_1');

    expect(out.hasGmcKey).toBe(true);
    expect(out).not.toHaveProperty('gmcServiceAccountKey');
    expect(out).not.toHaveProperty('gmcServiceAccountKeyEnc');
  });

  it('get throws CONFIG_NOT_FOUND when no row exists', async () => {
    const fake = makeFakeHandle({ configRow: undefined, credRow: undefined });
    const svc = new GoogleConfigService(fake.handle, crypto);

    await expect(svc.getByMerchantId('mer_missing')).rejects.toBeInstanceOf(NotFoundException);
    try {
      await svc.getByMerchantId('mer_missing');
      throw new Error('expected throw');
    } catch (e) {
      const resp = (e as NotFoundException).getResponse() as { error_code?: string };
      expect(resp.error_code).toBe('CONFIG_NOT_FOUND');
    }
  });

  it('upsert with gmcServiceAccountKey undefined does NOT set the key column (leave-unchanged semantics)', async () => {
    const fake = makeFakeHandle({ configRow: makeRow(), credRow: undefined });
    const svc = new GoogleConfigService(fake.handle, crypto);

    await svc.upsert('mer_1', makeInput()); // no gmcServiceAccountKey

    expect(fake.recorder.insertedValues).not.toHaveProperty('gmcServiceAccountKeyEnc');
    expect(fake.recorder.onDuplicateKeyUpdate).not.toHaveProperty('gmcServiceAccountKeyEnc');
  });

  it('needsReconnect is folded in from google_credentials', async () => {
    const fake = makeFakeHandle({
      configRow: makeRow(),
      credRow: { needsReconnect: 1 },
    });
    const svc = new GoogleConfigService(fake.handle, crypto);

    const out = await svc.getByMerchantId('mer_1');

    expect(out.needsReconnect).toBe(true);
  });

  it('upsert persists gmcStoreUrl and get returns it', async () => {
    const fake = makeFakeHandle({
      configRow: makeRow({ gmcStoreUrl: 'shop.merchant.com' }),
      credRow: undefined,
    });
    const svc = new GoogleConfigService(fake.handle, crypto);

    await svc.upsert('mer_1', makeInput({ gmcStoreUrl: 'shop.merchant.com' }));
    expect(fake.recorder.insertedValues?.gmcStoreUrl).toBe('shop.merchant.com');

    const out = await svc.getByMerchantId('mer_1');
    expect(out.gmcStoreUrl).toBe('shop.merchant.com');
  });

  it('coerces TINYINT boolean columns (ga4Enabled: 1 → true)', async () => {
    const fake = makeFakeHandle({
      // Stored as MySQL TINYINT 1, not a JS boolean.
      configRow: makeRow({ ga4Enabled: 1 as unknown as boolean }),
      credRow: undefined,
    });
    const svc = new GoogleConfigService(fake.handle, crypto);

    const out = await svc.getByMerchantId('mer_1');

    expect(out.ga4Enabled).toBe(true);
    expect(typeof out.ga4Enabled).toBe('boolean');
  });
});
