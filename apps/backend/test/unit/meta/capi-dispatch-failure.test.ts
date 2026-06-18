import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaCapiService } from '../../../src/modules/meta/capi/capi.service';

/**
 * Root-cause coverage for the event-loss bug: when a Meta CAPI send fails,
 * dispatch() must REPORT the failure (so the worker can withhold the ack and
 * let the batch redeliver) instead of swallowing it and resolving as success.
 */
describe('MetaCapiService.dispatch failure reporting', () => {
  const merchantId = 'm1';
  const config = {
    pixelId: '123',
    capiAccessToken: 'tok',
    dataSharingLevel: 'maximum' as const,
    productIdType: 'product_id' as const,
    debug: false,
    events: {},
  };

  let fetchMock: ReturnType<typeof vi.fn>;
  let service: MetaCapiService;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const configs = { getByMerchantId: vi.fn().mockResolvedValue(config) };
    const merchants = { findById: vi.fn().mockResolvedValue({ id: merchantId, isActive: true }) };
    service = new MetaCapiService(configs as never, merchants as never);
  });
  afterEach(() => vi.unstubAllGlobals());

  const events = [{ event_name: 'Purchase', event_id: 'e1' }];
  const ctx = { clientIp: '1.2.3.4' };

  it('reports failed=0 / dispatched on a 200 from Meta', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ events_received: 1 }), { status: 200 }));
    const res = await service.dispatch(merchantId, events, ctx);
    expect(res.failed).toBe(0);
    expect(res.dispatched).toBeGreaterThan(0);
  });

  it('reports failed>0 when Meta rejects (4xx), not a silent success', async () => {
    // 400 is non-retryable → sendToPixel throws immediately (no backoff wait).
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'bad' }), { status: 400 }));
    const res = await service.dispatch(merchantId, events, ctx);
    expect(res.failed).toBeGreaterThan(0);
    expect(res.dispatched).toBe(0);
  });
});
