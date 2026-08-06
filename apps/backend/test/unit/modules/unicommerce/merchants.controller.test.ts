import { describe, expect, it } from 'vitest';
import { UcMerchantsController } from '../../../../src/modules/unicommerce/merchants/merchants.controller';

describe('UcMerchantsController.me', () => {
  it('returns the merchant attached by the guard (via @CurrentMerchant)', () => {
    const controller = new UcMerchantsController();
    const merchant = {
      id: 'm1',
      isActive: true,
      installedAt: new Date('2026-01-01'),
      uninstalledAt: null,
    };

    expect(controller.me(merchant)).toBe(merchant);
  });
});
