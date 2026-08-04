import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { UcMerchantTokenGuard } from '../../../../src/modules/unicommerce/guards';

function fakeContext(headers: Record<string, string>) {
  const req = { headers } as never;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
}

describe('UcMerchantTokenGuard', () => {
  it('attaches the merchant to the request when the Bearer token resolves to an installed merchant', async () => {
    const merchants = {
      findById: vi.fn().mockResolvedValue({
        id: 'm1',
        isActive: true,
        installedAt: new Date('2026-01-01'),
        uninstalledAt: null,
      }),
    };
    const guard = new UcMerchantTokenGuard(merchants as never);
    const ctx = fakeContext({ authorization: 'Bearer m1' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(merchants.findById).toHaveBeenCalledWith('m1');
  });

  it('rejects when no Authorization/X-Merchant-Id header is present', async () => {
    const merchants = { findById: vi.fn() };
    const guard = new UcMerchantTokenGuard(merchants as never);
    const ctx = fakeContext({});

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(merchants.findById).not.toHaveBeenCalled();
  });

  it('rejects when the merchant id does not resolve to an installed merchant', async () => {
    const merchants = { findById: vi.fn().mockResolvedValue(null) };
    const guard = new UcMerchantTokenGuard(merchants as never);
    const ctx = fakeContext({ authorization: 'Bearer unknown-merchant' });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
