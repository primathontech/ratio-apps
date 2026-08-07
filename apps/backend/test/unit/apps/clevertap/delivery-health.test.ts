import { beforeEach, describe, expect, it } from 'vitest';
import type { CryptoService } from '../../../../src/core/crypto/crypto.service';
import { ClevertapConfigService } from '../../../../src/modules/clevertap/config/config.service';
import { type FakeClevertapDb, makeFakeClevertapHandle } from './helpers/fake-clevertap-db';
import {
  MERCHANT_ID,
  makeConfig,
  makeCrypto,
  makeForwardedEvent,
  makeMerchant,
} from './helpers/fakes';

describe('ClevertapConfigService.getDeliveryHealth', () => {
  let fake: FakeClevertapDb;
  let crypto: CryptoService;
  let service: ClevertapConfigService;

  beforeEach(() => {
    const built = makeFakeClevertapHandle();
    fake = built.fake;
    crypto = makeCrypto();
    fake.seed('merchants', makeMerchant());
    fake.seed('clevertap_configs', makeConfig());
    service = new ClevertapConfigService(built.handle, crypto);
  });

  it('returns an empty 24h window when nothing has been forwarded', async () => {
    const h = await service.getDeliveryHealth(MERCHANT_ID);
    expect(h).toMatchObject({
      windowHours: 24,
      sent: 0,
      failed: 0,
      skipped: 0,
      queued: 0,
      total: 0,
      successRate: null,
      perTopic: [],
      recentFailures: [],
    });
  });

  it('aggregates totals, success rate, per-topic, and recent failures; excludes rows outside the window', async () => {
    const now = Date.now();
    const recent = (mins: number) => new Date(now - mins * 60_000);
    const outOfWindow = new Date(now - 48 * 60 * 60 * 1000);

    let n = 0;
    const seed = (o: Parameters<typeof makeForwardedEvent>[0]) =>
      fake.seed('clevertap_forwarded_events', makeForwardedEvent({ id: `id-${++n}`, ...o }));

    seed({ topic: 'orders/paid', status: 'sent', sentAt: recent(10) });
    seed({ topic: 'orders/paid', status: 'sent', sentAt: recent(20) });
    seed({ topic: 'orders/paid', status: 'failed', error: 'boom', sentAt: recent(5) });
    seed({ topic: 'products/create', status: 'skipped', sentAt: recent(30) });
    seed({ topic: 'products/create', status: 'failed', error: 'nope', sentAt: recent(2) });
    seed({ topic: 'orders/paid', status: 'queued', sentAt: recent(1) });
    seed({ topic: 'orders/paid', status: 'enqueued', sentAt: recent(1) });
    seed({ topic: 'orders/paid', status: 'sent', sentAt: outOfWindow });

    const h = await service.getDeliveryHealth(MERCHANT_ID);

    expect(h.sent).toBe(2);
    expect(h.failed).toBe(2);
    expect(h.skipped).toBe(1);
    expect(h.queued).toBe(2);
    expect(h.total).toBe(5);
    expect(h.successRate).toBe(40);

    expect(h.perTopic[0]?.topic).toBe('orders/paid');
    expect(h.perTopic.find((t) => t.topic === 'orders/paid')).toMatchObject({
      sent: 2,
      failed: 1,
      skipped: 0,
    });
    expect(h.perTopic.find((t) => t.topic === 'products/create')).toMatchObject({
      sent: 0,
      failed: 1,
      skipped: 1,
    });

    expect(h.recentFailures.map((f) => f.topic)).toEqual(['products/create', 'orders/paid']);
    expect(h.recentFailures[0]?.error).toBe('nope');
  });
});
