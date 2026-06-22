import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaCapiService } from '../../../src/modules/meta/capi/capi.service';

/**
 * Root-cause coverage for the disabled-event-still-firing bug: when a merchant
 * turns an event OFF in the admin (config.events[...].enabled = false), the
 * server MUST drop it before dispatching to Meta — the per-event toggle has to
 * be authoritative server-side, since the public CAPI endpoint (and any stale /
 * cached SDK) can post a disabled event anyway.
 */
describe('MetaCapiService.dispatch — per-event enable/disable toggle', () => {
  const merchantId = 'm1';
  const baseConfig = {
    pixelId: '123',
    capiAccessToken: 'tok',
    dataSharingLevel: 'maximum' as const,
    productIdType: 'product_id' as const,
    debug: false,
    // PageView + ViewContent disabled, AddToCart enabled — keyed by OS name,
    // value carries the Meta event name + the enabled flag (the admin shape).
    events: {
      page_viewed: { enabled: false, name: 'PageView' },
      product_viewed: { enabled: false, name: 'ViewContent' },
      product_added_to_cart: { enabled: true, name: 'AddToCart' },
    },
  };

  let fetchMock: ReturnType<typeof vi.fn>;
  let service: MetaCapiService;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ events_received: 1 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const configs = { getByMerchantId: vi.fn().mockResolvedValue(baseConfig) };
    const merchants = { findById: vi.fn().mockResolvedValue({ id: merchantId, isActive: true }) };
    service = new MetaCapiService(configs as never, merchants as never);
  });
  afterEach(() => vi.unstubAllGlobals());

  const ctx = { clientIp: '1.2.3.4' };

  it('drops disabled events and dispatches only the enabled one', async () => {
    const res = await service.dispatch(
      merchantId,
      [
        { event_name: 'PageView', event_id: 'p1' },
        { event_name: 'ViewContent', event_id: 'v1' },
        { event_name: 'AddToCart', event_id: 'a1' },
      ],
      ctx,
    );

    expect(res.received).toBe(3);
    expect(res.dispatched).toBe(1); // only AddToCart

    // The body sent to Meta must contain ONLY the enabled event.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.data.map((d: { event_name: string }) => d.event_name)).toEqual(['AddToCart']);
  });

  it('dispatches nothing when every posted event is disabled', async () => {
    const res = await service.dispatch(
      merchantId,
      [
        { event_name: 'PageView', event_id: 'p1' },
        { event_name: 'ViewContent', event_id: 'v1' },
      ],
      ctx,
    );
    expect(res.dispatched).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows everything when config.events has no toggles (backward compatible)', async () => {
    const configs = { getByMerchantId: vi.fn().mockResolvedValue({ ...baseConfig, events: {} }) };
    const merchants = { findById: vi.fn().mockResolvedValue({ id: merchantId, isActive: true }) };
    service = new MetaCapiService(configs as never, merchants as never);

    const res = await service.dispatch(
      merchantId,
      [
        { event_name: 'PageView', event_id: 'p1' },
        { event_name: 'AddToCart', event_id: 'a1' },
      ],
      ctx,
    );
    expect(res.dispatched).toBe(2);
  });
});
