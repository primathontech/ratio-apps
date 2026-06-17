import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import type { GoogleDatabase } from '../../../../src/modules/google/db/types';
import type { GoogleAuthService } from '../../../../src/modules/google/google-oauth/google-auth.service';
import {
  FeedSyncService,
  type RatioProductsPort,
} from '../../../../src/modules/google/gmc/feed-sync.service';
import type { RatioProduct } from '../../../../src/modules/google/gmc/product-mapper';

const BASE = 'https://shoppingcontent.googleapis.com/content/v2.1';
const MERCHANT_ID = 'mer_1';
const GMC_MERCHANT_ID = '123456';

/** A captured feed_items write (only the bits the tests assert on). */
interface FeedItemWrite {
  offerId: string;
  status: string;
  issue: string | null;
}

/** A captured sync_log write. */
interface SyncLogWrite {
  syncType: string;
  productsChecked: number;
  productsUpdated: number;
  productsErrored: number;
}

/** A captured outbound fetch call. */
interface FetchCall {
  url: string;
  method: string | undefined;
}

/**
 * A fully GMC-enabled google_configs row. `selectAll().executeTakeFirst()` must
 * return a row with `gmcEnabled` truthy + `gmcMerchantId` set + the locale /
 * condition fields the mapper config reads, so `context()` is non-null.
 */
function configRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    merchantId: MERCHANT_ID,
    gmcEnabled: 1,
    gmcMerchantId: GMC_MERCHANT_ID,
    gmcTargetCountry: 'IN',
    gmcContentLanguage: 'en',
    gmcCurrency: 'INR',
    gmcDefaultCondition: 'new',
    gmcBrandOverride: null,
    gmcGoogleProductCategory: null,
    ...overrides,
  };
}

/**
 * A chainable, tolerant fake Kysely client. Every builder method returns `this`
 * so unused chain links (where/select/values/onDuplicateKeyUpdate/...) are
 * no-ops; the terminal `.execute()` / `.executeTakeFirst()` consult the recorded
 * table + last-staged values to capture writes and return the right reads.
 */
function makeFakeKysely(opts: {
  config: Record<string, unknown> | null;
  /** Rows returned by selectFrom('google_feed_items').select(['offerId']). */
  feedItemRows?: { offerId: string }[];
}): {
  handle: KyselyClient<GoogleDatabase>;
  feedItemWrites: FeedItemWrite[];
  syncLogWrites: SyncLogWrite[];
  feedItemUpdates: { status: string }[];
} {
  const feedItemWrites: FeedItemWrite[] = [];
  const syncLogWrites: SyncLogWrite[] = [];
  const feedItemUpdates: { status: string }[] = [];

  // --- selectFrom builders -------------------------------------------------
  const configSelect = {
    selectAll: () => configSelect,
    select: () => configSelect,
    where: () => configSelect,
    execute: async () => (opts.config ? [opts.config] : []),
    executeTakeFirst: async () => opts.config ?? undefined,
  };

  const merchantSelect = {
    select: () => merchantSelect,
    where: () => merchantSelect,
    execute: async () => [{ id: MERCHANT_ID }],
    executeTakeFirst: async () => ({ id: MERCHANT_ID }),
  };

  const feedItemSelect = {
    select: () => feedItemSelect,
    where: () => feedItemSelect,
    execute: async () => opts.feedItemRows ?? [],
    executeTakeFirst: async () => (opts.feedItemRows ?? [])[0],
  };

  // --- insertInto builders -------------------------------------------------
  const feedItemInsert = {
    staged: null as Record<string, unknown> | null,
    values(v: Record<string, unknown>) {
      this.staged = v;
      return this;
    },
    onDuplicateKeyUpdate() {
      return this;
    },
    async execute() {
      const v = this.staged ?? {};
      feedItemWrites.push({
        offerId: String(v.offerId ?? ''),
        status: String(v.status ?? ''),
        issue: (v.issue ?? null) as string | null,
      });
      this.staged = null;
      return [];
    },
  };

  const syncLogInsert = {
    staged: null as Record<string, unknown> | null,
    values(v: Record<string, unknown>) {
      this.staged = v;
      return this;
    },
    async execute() {
      const v = this.staged ?? {};
      syncLogWrites.push({
        syncType: String(v.syncType ?? ''),
        productsChecked: Number(v.productsChecked ?? 0),
        productsUpdated: Number(v.productsUpdated ?? 0),
        productsErrored: Number(v.productsErrored ?? 0),
      });
      this.staged = null;
      return [];
    },
  };

  // --- updateTable builder -------------------------------------------------
  const feedItemUpdate = {
    staged: null as Record<string, unknown> | null,
    set(v: Record<string, unknown>) {
      this.staged = v;
      return this;
    },
    where() {
      return this;
    },
    async execute() {
      const v = this.staged ?? {};
      feedItemUpdates.push({ status: String(v.status ?? '') });
      this.staged = null;
      return [];
    },
  };

  const db = {
    selectFrom(table: string) {
      if (table === 'google_configs') return configSelect;
      if (table === 'merchants') return merchantSelect;
      if (table === 'google_feed_items') return feedItemSelect;
      throw new Error(`unexpected selectFrom("${table}")`);
    },
    insertInto(table: string) {
      if (table === 'google_feed_items') return feedItemInsert;
      if (table === 'google_sync_log') return syncLogInsert;
      throw new Error(`unexpected insertInto("${table}")`);
    },
    updateTable(table: string) {
      if (table === 'google_feed_items') return feedItemUpdate;
      throw new Error(`unexpected updateTable("${table}")`);
    },
  };

  return {
    handle: { db, close: async () => {} } as unknown as KyselyClient<GoogleDatabase>,
    feedItemWrites,
    syncLogWrites,
    feedItemUpdates,
  };
}

function makeAuth(): GoogleAuthService {
  return {
    getAccessToken: vi.fn().mockResolvedValue('tok'),
    getGmcAccessToken: vi.fn().mockResolvedValue('tok'),
  } as unknown as GoogleAuthService;
}

function makeProducts(): RatioProductsPort & { listAll: ReturnType<typeof vi.fn> } {
  return { listAll: vi.fn() };
}

/** A valid product → one SYNCED offer (price + image + valid GTIN barcode). */
function makeProduct(id = 'p1'): RatioProduct {
  return {
    id,
    title: 'Blue Hat',
    description: 'A nice blue hat',
    handle: 'blue-hat',
    vendor: 'Acme',
    productType: 'Hats',
    images: [{ src: 'https://cdn.example.com/hat.jpg' }],
    variants: [
      {
        id: 'v1',
        price: '999.00',
        barcode: '0123456789012', // 13 digits → valid GTIN
        sku: 'SKU-1',
        inventoryQuantity: 5,
        options: { Color: 'Blue', Size: 'M' },
      },
    ],
  };
}

/** A bad product (no images) → the mapper yields an ERROR offer with gmc:null. */
function makeBadProduct(id = 'pbad'): RatioProduct {
  return {
    id,
    title: 'No Image Hat',
    description: 'missing image',
    handle: 'no-image-hat',
    images: [],
    variants: [{ id: 'vbad', price: '50.00', inventoryQuantity: 1 }],
  };
}

/** Build a stubbed global fetch that records calls and returns `handler()`. */
function fakeFetch(handler: (url: string) => Response): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fn = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method });
    return Promise.resolve(handler(String(url)));
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const ok = () => new Response(JSON.stringify({ id: 'x' }), { status: 200 });

describe('FeedSyncService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('syncProduct', () => {
    let products: ReturnType<typeof makeProducts>;

    beforeEach(() => {
      products = makeProducts();
    });

    it('pushes a valid product and records SYNCED', async () => {
      const fake = makeFakeKysely({ config: configRow() });
      const { fetch, calls } = fakeFetch(() => ok());
      vi.stubGlobal('fetch', fetch);

      const svc = new FeedSyncService(fake.handle, makeAuth(), products);
      const result = await svc.syncProduct(MERCHANT_ID, makeProduct());

      // listAll is only for full syncs — never touched here.
      expect(products.listAll).not.toHaveBeenCalled();

      // A POST to a /products insert URL happened.
      const insert = calls.find((c) => c.method === 'POST');
      expect(insert).toBeDefined();
      expect(insert?.url).toBe(`${BASE}/${GMC_MERCHANT_ID}/products`);

      // The feed item was written SYNCED, and a sync_log row appended.
      expect(fake.feedItemWrites).toEqual([
        { offerId: `${MERCHANT_ID}:v1`, status: 'SYNCED', issue: null },
      ]);
      expect(fake.syncLogWrites).toHaveLength(1);

      expect(result).toEqual({ updated: 1, errored: 0 });
    });

    it('on an ERROR offer does NOT call the API and records ERROR', async () => {
      const fake = makeFakeKysely({ config: configRow() });
      const { fetch, calls } = fakeFetch(() => ok());
      vi.stubGlobal('fetch', fetch);

      const svc = new FeedSyncService(fake.handle, makeAuth(), products);
      const result = await svc.syncProduct(MERCHANT_ID, makeBadProduct());

      // No insert call to GMC for an ERROR offer.
      expect(calls.find((c) => c.method === 'POST')).toBeUndefined();

      expect(fake.feedItemWrites).toHaveLength(1);
      expect(fake.feedItemWrites[0]?.status).toBe('ERROR');
      expect(result).toEqual({ updated: 0, errored: 1 });
    });

    it('records ERROR with the GMC message when the API rejects', async () => {
      const fake = makeFakeKysely({ config: configRow() });
      const { fetch } = fakeFetch(
        () => new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 }),
      );
      vi.stubGlobal('fetch', fetch);

      const svc = new FeedSyncService(fake.handle, makeAuth(), products);
      const result = await svc.syncProduct(MERCHANT_ID, makeProduct());

      expect(fake.feedItemWrites).toHaveLength(1);
      expect(fake.feedItemWrites[0]?.status).toBe('ERROR');
      expect(fake.feedItemWrites[0]?.issue).toContain('bad');
      expect(result).toEqual({ updated: 0, errored: 1 });
    });
  });

  describe('deleteProduct', () => {
    it('deletes each offer from GMC and marks feed items DELETED', async () => {
      const fake = makeFakeKysely({
        config: configRow(),
        feedItemRows: [{ offerId: 'm:v1' }, { offerId: 'm:v2' }],
      });
      const { fetch, calls } = fakeFetch(() => new Response(null, { status: 204 }));
      vi.stubGlobal('fetch', fetch);

      const svc = new FeedSyncService(fake.handle, makeAuth(), makeProducts());
      await svc.deleteProduct(MERCHANT_ID, 'p1');

      const deletes = calls.filter((c) => c.method === 'DELETE');
      expect(deletes).toHaveLength(2);

      // updateTable set status 'DELETED'.
      expect(fake.feedItemUpdates).toHaveLength(1);
      expect(fake.feedItemUpdates[0]?.status).toBe('DELETED');
    });
  });

  describe('fullSync', () => {
    it('batches via custombatch and logs an initial sync with the right counts', async () => {
      const fake = makeFakeKysely({ config: configRow() });
      const products = makeProducts();
      products.listAll.mockResolvedValue([makeProduct('p1'), makeProduct('p2')]);
      const { fetch, calls } = fakeFetch(() => new Response(JSON.stringify({}), { status: 200 }));
      vi.stubGlobal('fetch', fetch);

      const svc = new FeedSyncService(fake.handle, makeAuth(), products);
      const result = await svc.initialSync(MERCHANT_ID);

      // A POST to the batch endpoint happened.
      const batch = calls.find((c) => c.url === `${BASE}/products/batch`);
      expect(batch).toBeDefined();
      expect(batch?.method).toBe('POST');

      // A sync_log row recorded the 'initial' sync with the right counts: an
      // empty custombatch response (no `entries`) means nothing failed, so both
      // offers count as updated.
      expect(fake.syncLogWrites).toHaveLength(1);
      expect(fake.syncLogWrites[0]).toMatchObject({
        syncType: 'initial',
        productsChecked: 2,
        productsUpdated: 2,
        productsErrored: 0,
      });
      expect(result).toEqual({ updated: 2, errored: 0 });
    });
  });

  describe('GMC disabled', () => {
    it('is a no-op when context is null (gmcEnabled = 0)', async () => {
      const fake = makeFakeKysely({ config: configRow({ gmcEnabled: 0 }) });
      const { fetch, calls } = fakeFetch(() => ok());
      vi.stubGlobal('fetch', fetch);

      const svc = new FeedSyncService(fake.handle, makeAuth(), makeProducts());
      const result = await svc.syncProduct(MERCHANT_ID, makeProduct());

      expect(result).toEqual({ updated: 0, errored: 0 });
      expect(calls).toHaveLength(0);
      expect(fake.feedItemWrites).toHaveLength(0);
    });
  });
});
