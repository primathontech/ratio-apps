import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RpWebhooksService } from '../../../../src/modules/rp/webhooks/webhooks.service';

/**
 * Shopify's `app/uninstalled` webhook flips `StoreDetail.active = false` in RP's own
 * backend, and `sessionChecker.js` gates every customer-facing API on that flag — so
 * uninstalling actually cuts off portal access. The OS adapter never had an equivalent:
 * OS's uninstall event had nowhere to land, so `return_prime_merchants.active` stayed
 * `true` forever and `RpRequestGuard` (which already filters on it via
 * `RpMerchantsService.findByDomain`) never closed the gate.
 *
 * Deactivating the ADAPTER's own `return_prime_merchants` row is only half the fix —
 * RP's own backend never learns about it either, so its `StoreDetail.active` (the flag
 * `sessionChecker.js` actually gates on) would stay `true` forever for that store. The
 * adapter must also call RP's `POST /shopify-webhook/v1/os-uninstall` (the deactivation
 * counterpart to the existing `os-install` onboarding call), the same way `forward()`
 * already relays product webhooks to `${RP_BASE_URL}/shopify-webhook/v1/{topic}`.
 *
 * `setMerchantActiveStatus` is the shared implementation behind both the real OS
 * `app/uninstalled` webhook (always `active=false`, via `handleAppUninstalled`) and the
 * merchant's own pause/resume toggle in admin-rp (either direction, via
 * `RpAdminController`). RP's `os-uninstall` endpoint doubles as the reactivate call too
 * (an `active` flag in the body selects the direction) — OS has no OAuth/billing
 * reinstall flow to hang a real "reactivate" event off of, unlike real Shopify.
 */
const CONFIG_VALUES: Record<string, string> = {
  RP_BASE_URL: 'https://devapi.returnprime.co',
  OS_RP_TOKEN: 'rp-test-token',
};

function makeService(overrides: {
  findByMerchantId?: ReturnType<typeof vi.fn>;
  setActive?: ReturnType<typeof vi.fn>;
} = {}) {
  const merchants = {
    findByMerchantId: overrides.findByMerchantId ?? vi.fn(),
    setActive: overrides.setActive ?? vi.fn().mockResolvedValue(undefined),
  };
  // transformer / orderSync are unused by these methods — plain stubs.
  const transformer = {};
  const config = { get: (key: string) => CONFIG_VALUES[key] };
  const orderSync = {};
  return new RpWebhooksService(
    merchants as never,
    transformer as never,
    config as never,
    orderSync as never,
  );
}

describe('RpWebhooksService.handleAppUninstalled', () => {
  // handleAppUninstalled always relays to RP over `fetch` once it finds a merchant —
  // stub it globally so no test in this file makes a real network call.
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('deactivates the merchant when OS reports the app was uninstalled', async () => {
    const findByMerchantId = vi.fn().mockResolvedValue({ merchantId: 'm1', domain: 'store.dev.gokwik.io' });
    const setActive = vi.fn().mockResolvedValue(undefined);
    const service = makeService({ findByMerchantId, setActive });

    await service.handleAppUninstalled('m1');

    expect(setActive).toHaveBeenCalledWith('m1', false);
  });

  it('is a no-op when the merchant is not found (unknown/stale merchant id)', async () => {
    const findByMerchantId = vi.fn().mockResolvedValue(undefined);
    const setActive = vi.fn();
    const service = makeService({ findByMerchantId, setActive });

    await service.handleAppUninstalled('unknown');

    expect(setActive).not.toHaveBeenCalled();
  });

  it('is a no-op when merchantId is missing', async () => {
    const setActive = vi.fn();
    const service = makeService({ setActive });

    await service.handleAppUninstalled('');

    expect(setActive).not.toHaveBeenCalled();
  });

  describe('relaying the uninstall to RP itself', () => {
    it('calls RP\'s os-uninstall endpoint with the internal token, store domain, and active:false', async () => {
      const findByMerchantId = vi.fn().mockResolvedValue({ merchantId: 'm1', domain: 'store.dev.gokwik.io' });
      const service = makeService({ findByMerchantId });

      await service.handleAppUninstalled('m1');

      expect(fetch).toHaveBeenCalledWith(
        'https://devapi.returnprime.co/shopify-webhook/v1/os-uninstall',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-OS-Internal-Token': 'rp-test-token' }),
          body: JSON.stringify({ merchant_id: 'store.dev.gokwik.io', active: false }),
        }),
      );
    });

    it('does not call RP when the merchant is not found', async () => {
      const findByMerchantId = vi.fn().mockResolvedValue(undefined);
      const service = makeService({ findByMerchantId });

      await service.handleAppUninstalled('unknown');

      expect(fetch).not.toHaveBeenCalled();
    });
  });
});

describe('RpWebhooksService.setMerchantActiveStatus', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sets active=true locally and relays active:true to RP (merchant self-service resume)', async () => {
    const setActive = vi.fn().mockResolvedValue(undefined);
    const service = makeService({ setActive });

    await service.setMerchantActiveStatus('m1', 'store.dev.gokwik.io', true);

    expect(setActive).toHaveBeenCalledWith('m1', true);
    expect(fetch).toHaveBeenCalledWith(
      'https://devapi.returnprime.co/shopify-webhook/v1/os-uninstall',
      expect.objectContaining({
        body: JSON.stringify({ merchant_id: 'store.dev.gokwik.io', active: true }),
      }),
    );
  });

  it('sets active=false locally and relays active:false to RP (merchant self-service pause)', async () => {
    const setActive = vi.fn().mockResolvedValue(undefined);
    const service = makeService({ setActive });

    await service.setMerchantActiveStatus('m1', 'store.dev.gokwik.io', false);

    expect(setActive).toHaveBeenCalledWith('m1', false);
    expect(fetch).toHaveBeenCalledWith(
      'https://devapi.returnprime.co/shopify-webhook/v1/os-uninstall',
      expect.objectContaining({
        body: JSON.stringify({ merchant_id: 'store.dev.gokwik.io', active: false }),
      }),
    );
  });

  it('still updates locally even when RP is not configured, but skips the relay', async () => {
    const setActive = vi.fn().mockResolvedValue(undefined);
    const merchants = { findByMerchantId: vi.fn(), setActive };
    const config = { get: () => undefined };
    const service = new RpWebhooksService(
      merchants as never,
      {} as never,
      config as never,
      {} as never,
    );

    await service.setMerchantActiveStatus('m1', 'store.dev.gokwik.io', true);

    expect(setActive).toHaveBeenCalledWith('m1', true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not throw when the RP relay fails — local state change already succeeded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const setActive = vi.fn().mockResolvedValue(undefined);
    const service = makeService({ setActive });

    await expect(service.setMerchantActiveStatus('m1', 'store.dev.gokwik.io', true)).resolves.toBeUndefined();
    expect(setActive).toHaveBeenCalledWith('m1', true);
  });
});
