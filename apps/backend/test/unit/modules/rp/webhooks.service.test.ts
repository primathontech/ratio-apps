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
 */
const CONFIG_VALUES: Record<string, string> = {
  RP_BASE_URL: 'https://devapi.returnprime.co',
  OS_RP_TOKEN: 'rp-test-token',
};

function makeService(overrides: {
  findByMerchantId?: ReturnType<typeof vi.fn>;
  deactivate?: ReturnType<typeof vi.fn>;
} = {}) {
  const merchants = {
    findByMerchantId: overrides.findByMerchantId ?? vi.fn(),
    deactivate: overrides.deactivate ?? vi.fn().mockResolvedValue(undefined),
  };
  // transformer / orderSync are unused by handleAppUninstalled — plain stubs.
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
    const deactivate = vi.fn().mockResolvedValue(undefined);
    const service = makeService({ findByMerchantId, deactivate });

    await service.handleAppUninstalled('m1');

    expect(deactivate).toHaveBeenCalledWith('m1');
  });

  it('is a no-op when the merchant is not found (unknown/stale merchant id)', async () => {
    const findByMerchantId = vi.fn().mockResolvedValue(undefined);
    const deactivate = vi.fn();
    const service = makeService({ findByMerchantId, deactivate });

    await service.handleAppUninstalled('unknown');

    expect(deactivate).not.toHaveBeenCalled();
  });

  it('is a no-op when merchantId is missing', async () => {
    const deactivate = vi.fn();
    const service = makeService({ deactivate });

    await service.handleAppUninstalled('');

    expect(deactivate).not.toHaveBeenCalled();
  });

  describe('relaying the uninstall to RP itself', () => {
    it('calls RP\'s os-uninstall endpoint with the internal token and store domain', async () => {
      const findByMerchantId = vi.fn().mockResolvedValue({ merchantId: 'm1', domain: 'store.dev.gokwik.io' });
      const service = makeService({ findByMerchantId });

      await service.handleAppUninstalled('m1');

      expect(fetch).toHaveBeenCalledWith(
        'https://devapi.returnprime.co/shopify-webhook/v1/os-uninstall',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-OS-Internal-Token': 'rp-test-token' }),
          body: JSON.stringify({ merchant_id: 'store.dev.gokwik.io' }),
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
