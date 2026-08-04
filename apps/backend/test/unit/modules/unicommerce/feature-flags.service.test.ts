import { describe, expect, it, vi } from 'vitest';
import type { UcConfig } from '../../../../src/modules/unicommerce/services/config.service';
import { UcFeatureFlagsService } from '../../../../src/modules/unicommerce/services/feature-flags.service';

const allFalse: UcConfig = {
  productSyncEnabled: false,
  inventorySyncEnabled: false,
  orderPushEnabled: false,
  dispatchStatusSyncEnabled: false,
  cancelSyncEnabled: false,
  notificationsEnabled: false,
};

/** vi.fn()-mocked UcConfigService — never touches a real DB. */
function fakeConfigService(rows: Record<string, Partial<UcConfig>>) {
  const getByMerchantId = vi
    .fn()
    .mockImplementation(async (merchantId: string): Promise<UcConfig> => {
      return { ...allFalse, ...rows[merchantId] };
    });
  return { getByMerchantId };
}

describe('UcFeatureFlagsService.isEnabled', () => {
  it('returns false for a merchant with no config row (all flags default to disabled)', async () => {
    const config = fakeConfigService({});
    const svc = new UcFeatureFlagsService(config as never);

    expect(await svc.isEnabled('order_push', 'm1')).toBe(false);
    expect(await svc.isEnabled('product_sync', 'm1')).toBe(false);
    expect(await svc.isEnabled('notifications', 'm1')).toBe(false);
  });

  it('returns true for a gate the merchant has explicitly enabled, and false for the others', async () => {
    const config = fakeConfigService({ m1: { productSyncEnabled: true } });
    const svc = new UcFeatureFlagsService(config as never);

    expect(await svc.isEnabled('product_sync', 'm1')).toBe(true);
    expect(await svc.isEnabled('inventory_sync', 'm1')).toBe(false);
    expect(await svc.isEnabled('order_push', 'm1')).toBe(false);
  });

  it('keeps two different merchants fully independent (per-merchant isolation)', async () => {
    const config = fakeConfigService({
      m1: { orderPushEnabled: true },
      m2: { cancelSyncEnabled: true },
    });
    const svc = new UcFeatureFlagsService(config as never);

    expect(await svc.isEnabled('order_push', 'm1')).toBe(true);
    expect(await svc.isEnabled('order_push', 'm2')).toBe(false);
    expect(await svc.isEnabled('cancel_sync', 'm2')).toBe(true);
    expect(await svc.isEnabled('cancel_sync', 'm1')).toBe(false);
  });

  it('caches per-merchant config: two isEnabled calls for the same merchant hit the config service only once', async () => {
    const config = fakeConfigService({
      m1: { productSyncEnabled: true, notificationsEnabled: true },
    });
    const svc = new UcFeatureFlagsService(config as never);

    expect(await svc.isEnabled('product_sync', 'm1')).toBe(true);
    expect(await svc.isEnabled('notifications', 'm1')).toBe(true);

    expect(config.getByMerchantId).toHaveBeenCalledTimes(1);
  });

  it('invalidates the cached config for a merchant, forcing a fresh read on the next isEnabled call', async () => {
    const config = fakeConfigService({ m1: { productSyncEnabled: true } });
    const svc = new UcFeatureFlagsService(config as never);

    expect(await svc.isEnabled('product_sync', 'm1')).toBe(true);
    svc.invalidate('m1');
    expect(await svc.isEnabled('product_sync', 'm1')).toBe(true);

    expect(config.getByMerchantId).toHaveBeenCalledTimes(2);
  });
});
