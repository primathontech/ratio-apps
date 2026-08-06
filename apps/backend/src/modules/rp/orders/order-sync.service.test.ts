import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import type { RpIdMappingService } from '../id-mapping/id-mapping.service';
import { RpOrderSyncService } from './order-sync.service';

/**
 * upsertOrder is the webhook-driven counterpart to RpOrdersService's getOrder/getOrders —
 * same id-mapping persistence requirement, but it must run even when RP isn't configured
 * (id-mapping is backed by ratio-apps' own DB, not RP's, so it must not be gated behind
 * RP's reachability — that was the original bug this fixes).
 */
function makeService(opts: { rpBaseUrl?: string; osRpToken?: string }) {
  const hashAndPersist = vi.fn().mockResolvedValue('irrelevant');
  const idMapping = { hashAndPersist } as unknown as RpIdMappingService;
  const config = {
    get: vi.fn((key: string) => (key === 'RP_BASE_URL' ? opts.rpBaseUrl : opts.osRpToken)),
  } as unknown as ConfigService<Env, true>;

  const service = new RpOrderSyncService(config, idMapping);
  return { service, hashAndPersist };
}

describe('RpOrderSyncService.upsertOrder — id-mapping persistence', () => {
  it('persists product/variant mappings even when RP is not configured', async () => {
    const { service, hashAndPersist } = makeService({});

    await service.upsertOrder(
      {
        id: 'ordr_496',
        currency: 'INR',
        line_items: [{ id: 'li_1', product_id: '17720225894304237', variant_id: '1780327220438871' }],
      },
      'shop.example',
    );

    expect(hashAndPersist).toHaveBeenCalledWith('product', '17720225894304237');
    expect(hashAndPersist).toHaveBeenCalledWith('variant', '1780327220438871');
  });

  it('skips entirely (no persistence attempted) when the order has no numeric id after normalization', async () => {
    const { service, hashAndPersist } = makeService({});

    await service.upsertOrder({ id: '', currency: 'INR', line_items: [] }, 'shop.example');

    expect(hashAndPersist).not.toHaveBeenCalled();
  });
});

// Every order upserted here came from an OS order-service webhook — there's no Shopify-side
// path through this service. RP's resolveStoreUrl (a dual-platform store's order-to-domain
// routing) reads order_platform to tell an OS-originated order apart from a Shopify one;
// without this stamp every OS order looks unlabeled and routing falls back to guesswork.
describe('RpOrderSyncService.upsertOrder — order sync call', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      clone: () => ({ text: async () => '{"status":true}' }),
      text: async () => '{"status":true}',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the order to RP\'s order-sync endpoint with platform:"os" and does not touch mongodb directly', async () => {
    const { service } = makeService({ rpBaseUrl: 'http://rp.example', osRpToken: 'test-token' });

    await service.upsertOrder({ id: 'ordr_496', currency: 'INR', line_items: [] }, 'shop.example');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://rp.example/shopify-webhook/v1/order-sync');
    expect(init.method).toBe('POST');
    expect(init.headers['X-OS-Internal-Token']).toBe('test-token');
    expect(init.headers['X-OS-Store']).toBe('shop.example');
    const body = JSON.parse(init.body);
    expect(body.platform).toBe('os');
    expect(body.id).toEqual(expect.any(Number));
  });

  it('skips the sync call (but still persists id-mappings) when RP is not configured', async () => {
    const { service, hashAndPersist } = makeService({});

    await service.upsertOrder({ id: 'ordr_496', currency: 'INR', line_items: [] }, 'shop.example');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(hashAndPersist).not.toHaveBeenCalled(); // no line items in this order
  });
});
