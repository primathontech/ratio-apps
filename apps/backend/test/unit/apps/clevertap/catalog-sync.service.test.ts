import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/modules/clevertap/events/clevertap-catalog.client', async (orig) => {
  const actual =
    await orig<
      typeof import('../../../../src/modules/clevertap/events/clevertap-catalog.client')
    >();
  return { ...actual, CLEVERTAP_CATALOG_CONTRACT_VERIFIED: true };
});

import type {
  ClevertapCatalogResult,
  ClevertapCatalogUploadInput,
} from '../../../../src/modules/clevertap/events/clevertap-catalog.client';
import { ClevertapCatalogSyncService } from '../../../../src/modules/clevertap/sync/catalog-sync.service';
import type { ClevertapProductSource } from '../../../../src/modules/clevertap/sync/product-source.client';
import { type FakeClevertapDb, makeFakeClevertapHandle } from './helpers/fake-clevertap-db';
import { ACCOUNT_ID, MERCHANT_ID, makeConfig, makeCrypto, PASSCODE } from './helpers/fakes';

const CATALOG_NAME = 'ratio-products';
const CATALOG_EMAIL = 'ops@ratio.test';

function makeProductSource(products: Record<string, unknown>[]): ClevertapProductSource {
  return { fetchAllProducts: vi.fn(async () => products) };
}

describe('ClevertapCatalogSyncService', () => {
  let fake: FakeClevertapDb;
  let handle: ReturnType<typeof makeFakeClevertapHandle>['handle'];
  const crypto = makeCrypto();

  const products = [
    { id: 'p1', title: 'Widget Alpha', price: 19900, status: 'active' },
    { id: 'p2', title: 'Widget Beta', price: 29900, status: 'active' },
  ];

  let uploadCalls: ClevertapCatalogUploadInput[];
  const catalogFactory = () => ({
    upsert: vi.fn(),
    remove: vi.fn(),
    uploadCatalog: vi.fn(
      async (input: ClevertapCatalogUploadInput): Promise<ClevertapCatalogResult> => {
        uploadCalls.push(input);
        return { ok: true, status: 200 };
      },
    ),
  });

  beforeEach(() => {
    const built = makeFakeClevertapHandle();
    fake = built.fake;
    handle = built.handle;
    uploadCalls = [];
  });

  function build(source = makeProductSource(products)) {
    return new ClevertapCatalogSyncService(handle, crypto, source, catalogFactory);
  }

  it('skips a disabled config and never calls uploadCatalog', async () => {
    fake.seed(
      'clevertap_configs',
      makeConfig({
        accountId: ACCOUNT_ID,
        catalogName: CATALOG_NAME,
        catalogEmail: CATALOG_EMAIL,
        catalogSyncEnabled: false,
        passcodeEnc: crypto.encrypt(PASSCODE),
      }),
    );

    const result = await build().syncMerchant(MERCHANT_ID);

    expect(result).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(uploadCalls).toHaveLength(0);
  });

  it('skips when the app is disabled and never calls uploadCatalog', async () => {
    fake.seed(
      'clevertap_configs',
      makeConfig({
        accountId: ACCOUNT_ID,
        catalogName: CATALOG_NAME,
        catalogEmail: CATALOG_EMAIL,
        catalogSyncEnabled: true,
        clevertapEnabled: false,
        passcodeEnc: crypto.encrypt(PASSCODE),
      }),
    );

    const result = await build().syncMerchant(MERCHANT_ID);

    expect(result).toEqual({ status: 'skipped', reason: 'app disabled' });
    expect(uploadCalls).toHaveLength(0);
  });

  it('skips when the platform switch is off, even with a fully enabled config', async () => {
    fake.seed(
      'clevertap_configs',
      makeConfig({
        accountId: ACCOUNT_ID,
        catalogName: CATALOG_NAME,
        catalogEmail: CATALOG_EMAIL,
        catalogSyncEnabled: true,
        clevertapEnabled: true,
        passcodeEnc: crypto.encrypt(PASSCODE),
      }),
    );

    const service = new ClevertapCatalogSyncService(
      handle,
      crypto,
      makeProductSource(products),
      catalogFactory,
      false,
    );
    const result = await service.syncMerchant(MERCHANT_ID);

    expect(result).toEqual({ status: 'skipped', reason: 'platform disabled' });
    expect(uploadCalls).toHaveLength(0);
  });

  it('uploads the full catalog as a replace when enabled', async () => {
    fake.seed(
      'clevertap_configs',
      makeConfig({
        accountId: ACCOUNT_ID,
        catalogName: CATALOG_NAME,
        catalogEmail: CATALOG_EMAIL,
        catalogSyncEnabled: true,
        passcodeEnc: crypto.encrypt(PASSCODE),
      }),
    );

    const result = await build().syncMerchant(MERCHANT_ID);

    expect(result.status).toBe('sent');
    expect(result.itemCount).toBe(2);

    expect(uploadCalls).toHaveLength(1);
    const [call] = uploadCalls;
    expect(call.replace).toBe(true);
    expect(call.name).toBe(CATALOG_NAME);
    expect(call.email).toBe(CATALOG_EMAIL);
    expect(call.accountId).toBe(ACCOUNT_ID);
    expect(call.csv).toContain('Widget Alpha');
    expect(call.csv).toContain('Widget Beta');
  });

  it('records the outcome on the config row so the admin shows a durable status', async () => {
    fake.seed(
      'clevertap_configs',
      makeConfig({
        accountId: ACCOUNT_ID,
        catalogName: CATALOG_NAME,
        catalogEmail: CATALOG_EMAIL,
        catalogSyncEnabled: true,
        passcodeEnc: crypto.encrypt(PASSCODE),
      }),
    );

    await build().syncMerchant(MERCHANT_ID);

    const row = fake.config(MERCHANT_ID);
    expect(row?.lastCatalogSyncStatus).toBe('sent');
    expect(row?.lastCatalogSyncCount).toBe(2);
    expect(row?.lastCatalogSyncError).toBeNull();
    expect(row?.lastCatalogSyncAt).toBeInstanceOf(Date);
  });
});
