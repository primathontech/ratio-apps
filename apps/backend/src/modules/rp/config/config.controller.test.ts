import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RpConfigController } from './config.controller';
import type { RpMerchantsService } from '../merchants/merchants.service';
import type { RpRequest } from '../guards';

function makeController(merchants: Partial<RpMerchantsService>) {
  return new RpConfigController(merchants as RpMerchantsService);
}

describe('RpConfigController.getConfig (public — storefront reads visibility)', () => {
  it('returns the merchant flag when the shop is known', async () => {
    const merchants = {
      findByDomain: vi.fn().mockResolvedValue({ merchantId: 'm1', returnExchangeEnabled: false }),
    };
    const ctrl = makeController(merchants);
    await expect(ctrl.getConfig('shop.example')).resolves.toEqual({ returnExchangeEnabled: false });
    expect(merchants.findByDomain).toHaveBeenCalledWith('shop.example');
  });

  it('defaults to enabled (fail-open) when the merchant is unknown', async () => {
    const merchants = { findByDomain: vi.fn().mockResolvedValue(undefined) };
    const ctrl = makeController(merchants);
    await expect(ctrl.getConfig('unknown.example')).resolves.toEqual({ returnExchangeEnabled: true });
  });

  it('throws BadRequest when shop is missing', async () => {
    const ctrl = makeController({ findByDomain: vi.fn() });
    await expect(ctrl.getConfig(undefined)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RpConfigController.setConfig (guarded — RP toggles on enable/disable)', () => {
  it('persists the flag for the authenticated merchant and echoes it back', async () => {
    const merchants = { setReturnExchangeEnabled: vi.fn().mockResolvedValue(undefined) };
    const ctrl = makeController(merchants);
    const req = { rpMerchant: { merchantId: 'm1' } } as RpRequest;

    await expect(ctrl.setConfig(req, { returnExchangeEnabled: false })).resolves.toEqual({
      returnExchangeEnabled: false,
    });
    expect(merchants.setReturnExchangeEnabled).toHaveBeenCalledWith('m1', false);
  });

  it('coerces a missing body to disabled=false', async () => {
    const merchants = { setReturnExchangeEnabled: vi.fn().mockResolvedValue(undefined) };
    const ctrl = makeController(merchants);
    const req = { rpMerchant: { merchantId: 'm1' } } as RpRequest;

    await expect(ctrl.setConfig(req, {})).resolves.toEqual({ returnExchangeEnabled: false });
    expect(merchants.setReturnExchangeEnabled).toHaveBeenCalledWith('m1', false);
  });
});
