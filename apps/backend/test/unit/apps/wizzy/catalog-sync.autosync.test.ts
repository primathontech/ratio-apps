import { describe, expect, it, vi } from 'vitest';
import { CatalogSyncService } from '../../../../src/modules/wizzy/catalog/catalog-sync.service';
import type { RatioProduct } from '../../../../src/modules/wizzy/catalog/wizzy-transform';

/**
 * Generic chainable Kysely mock: every builder method returns the chain;
 * `executeTakeFirst` yields the config row, `execute` yields []. Enough for
 * `context()` (config read) + the writeCatalogItem / writeSyncLog writes.
 */
function makeHandle(configRow: unknown) {
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'executeTakeFirst') return () => Promise.resolve(configRow);
        if (prop === 'execute') return () => Promise.resolve([]);
        return () => chain;
      },
    },
  );
  return { db: chain } as never;
}

function configRow(autoSyncEnabled: boolean) {
  return {
    wizzyEnabled: true,
    autoSyncEnabled,
    storeId: 's1',
    storeSecretEnc: 'enc:secret',
    apiKeyEnc: 'enc:key',
    storeUrl: 'https://shop.example.com',
    includeOutOfStock: true,
    stripHtmlDescription: true,
  };
}

function makeDeps() {
  const products = { listAll: vi.fn(async () => []), getById: vi.fn() };
  const crypto = { decrypt: (s: string) => s, encrypt: (s: string) => s };
  const wizzy = { saveProducts: vi.fn(async () => {}), deleteProducts: vi.fn(async () => {}) };
  const redis = { firstSeen: vi.fn(async () => true), del: vi.fn(async () => {}) };
  return { products, crypto, wizzy, redis };
}

function makeService(autoSyncEnabled: boolean) {
  const deps = makeDeps();
  const svc = new CatalogSyncService(
    makeHandle(configRow(autoSyncEnabled)),
    deps.wizzy as never,
    deps.products as never,
    deps.crypto as never,
    deps.redis as never,
  );
  return { svc, ...deps };
}

const PRODUCT: RatioProduct = {
  id: 'prod-1',
  title: 'Cool Shirt',
  handle: 'cool-shirt',
  productType: 'Apparel',
  images: [{ src: 'https://img.example.com/1.jpg' }],
  variants: [{ id: 'var-1', price: '999', compareAtPrice: '1299', inventoryQuantity: 5 }],
};

describe('CatalogSyncService — auto-sync gate', () => {
  it('does NOT sync a webhook product change when autoSyncEnabled is false', async () => {
    const { svc, wizzy } = makeService(false);

    const result = await svc.syncProduct('m1', PRODUCT, 'webhook');

    expect(wizzy.saveProducts).not.toHaveBeenCalled();
    expect(result).toEqual({ updated: 0, errored: 0 });
  });

  it('DOES sync a webhook product change when autoSyncEnabled is true', async () => {
    const { svc, wizzy } = makeService(true);

    await svc.syncProduct('m1', PRODUCT, 'webhook');

    expect(wizzy.saveProducts).toHaveBeenCalledTimes(1);
  });

  it('still syncs a MANUAL sync even when autoSyncEnabled is false (not gated)', async () => {
    const { svc, wizzy } = makeService(false);

    await svc.syncProduct('m1', PRODUCT, 'manual');

    expect(wizzy.saveProducts).toHaveBeenCalledTimes(1);
  });

  it('does NOT delete from Wizzy when autoSyncEnabled is false', async () => {
    const { svc, wizzy } = makeService(false);

    await svc.deleteProduct('m1', 'prod-1');

    expect(wizzy.deleteProducts).not.toHaveBeenCalled();
  });

  it('DOES delete from Wizzy when autoSyncEnabled is true', async () => {
    const { svc, wizzy } = makeService(true);

    await svc.deleteProduct('m1', 'prod-1');

    expect(wizzy.deleteProducts).toHaveBeenCalledTimes(1);
  });
});
