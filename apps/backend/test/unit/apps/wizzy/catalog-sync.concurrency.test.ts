import { describe, expect, it, vi } from 'vitest';
import { CatalogSyncService } from '../../../../src/modules/wizzy/catalog/catalog-sync.service';

/**
 * Generic chainable Kysely mock: every builder method returns the chain;
 * `executeTakeFirst` yields the config row, `execute` yields []. Enough for
 * `context()` (config read) + the runFullSync writes.
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

const CONFIG_ROW = {
  wizzyEnabled: true,
  storeId: 's1',
  storeSecretEnc: 'enc:secret',
  apiKeyEnc: 'enc:key',
  storeUrl: 'https://shop.example.com',
  includeOutOfStock: true,
  stripHtmlDescription: true,
};

function makeDeps(listAll: () => Promise<unknown>) {
  const products = { listAll: vi.fn(listAll), getById: vi.fn() };
  const crypto = { decrypt: (s: string) => s, encrypt: (s: string) => s };
  const wizzy = { saveProducts: vi.fn(async () => {}), deleteProducts: vi.fn(async () => {}) };
  // Redis lock acquired on first call; del on release. firstSeen=true mirrors
  // both "Redis disabled" and "lock free".
  const redis = { firstSeen: vi.fn(async () => true), del: vi.fn(async () => {}) };
  return { products, crypto, wizzy, redis };
}

describe('CatalogSyncService — full-sync concurrency guard', () => {
  it('runs only once while a sync is already in progress', async () => {
    // First sync hangs inside listAll → the lock stays held.
    const { products, crypto, wizzy, redis } = makeDeps(() => new Promise(() => {}));
    const svc = new CatalogSyncService(
      makeHandle(CONFIG_ROW),
      wizzy as never,
      products as never,
      crypto as never,
      redis as never,
    );

    const first = svc.fullSync('m1', 'manual'); // claims the lock, hangs in listAll
    await new Promise((r) => setTimeout(r, 0)); // let it reach listAll

    const second = await svc.fullSync('m1', 'manual'); // must be skipped, not started

    expect(second).toEqual({ updated: 0, errored: 0 });
    expect(products.listAll).toHaveBeenCalledTimes(1); // only the first one started
    void first; // leave the first hanging; test ends
  });

  it('allows a new sync after the previous one finishes', async () => {
    // Empty catalog → first sync completes immediately and releases the lock.
    const { products, crypto, wizzy, redis } = makeDeps(async () => []);
    const svc = new CatalogSyncService(
      makeHandle(CONFIG_ROW),
      wizzy as never,
      products as never,
      crypto as never,
      redis as never,
    );

    await svc.fullSync('m1', 'manual');
    await svc.fullSync('m1', 'manual');

    expect(products.listAll).toHaveBeenCalledTimes(2); // both ran (lock released between)
    expect(redis.del).toHaveBeenCalledTimes(2); // lock released each time
  });

  it('locks per-merchant, not globally', async () => {
    const { products, crypto, wizzy, redis } = makeDeps(() => new Promise(() => {}));
    const svc = new CatalogSyncService(
      makeHandle(CONFIG_ROW),
      wizzy as never,
      products as never,
      crypto as never,
      redis as never,
    );

    const a = svc.fullSync('mA', 'manual'); // hangs
    const b = svc.fullSync('mB', 'manual'); // different merchant → also starts
    await new Promise((r) => setTimeout(r, 0));

    expect(products.listAll).toHaveBeenCalledTimes(2); // both merchants started
    void a;
    void b;
  });
});
