import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { RpRequestGuard } from '../../../../src/modules/rp/guards';

const MERCHANT = { merchantId: 'm1', domain: 'shop.myshopify.com' };

function makeCtx(headers: Record<string, string | undefined>) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as never;
}

function makeConfig(values: Record<string, string>) {
  return { get: (key: string) => values[key] } as never;
}

function makeMerchants(findByDomain: ReturnType<typeof vi.fn>) {
  return { findByDomain } as never;
}

describe('RpRequestGuard — RP_PLATFORM_KILL_SWITCH_ENABLED kill switch', () => {
  const headers = { 'x-shopify-access-token': 'tok', 'x-store': 'shop.myshopify.com' };

  it('returns 503 and never touches the merchant lookup when compat is disabled', async () => {
    const findByDomain = vi.fn().mockResolvedValue(MERCHANT);
    const guard = new RpRequestGuard(
      makeMerchants(findByDomain),
      makeConfig({ RP_PLATFORM_KILL_SWITCH_ENABLED: 'false', OS_RP_TOKEN: 'tok' }),
    );

    await expect(guard.canActivate(makeCtx(headers))).rejects.toThrow(ServiceUnavailableException);
    expect(findByDomain).not.toHaveBeenCalled();
  });

  it('proceeds to normal token/merchant checks when compat is enabled', async () => {
    const findByDomain = vi.fn().mockResolvedValue(MERCHANT);
    const guard = new RpRequestGuard(
      makeMerchants(findByDomain),
      makeConfig({ RP_PLATFORM_KILL_SWITCH_ENABLED: 'true', OS_RP_TOKEN: 'tok' }),
    );

    await expect(guard.canActivate(makeCtx(headers))).resolves.toBe(true);
    expect(findByDomain).toHaveBeenCalled();
  });

  it('proceeds when compat flag is unset (schema default is "true")', async () => {
    const findByDomain = vi.fn().mockResolvedValue(MERCHANT);
    const guard = new RpRequestGuard(
      makeMerchants(findByDomain),
      makeConfig({ OS_RP_TOKEN: 'tok' }),
    );

    await expect(guard.canActivate(makeCtx(headers))).resolves.toBe(true);
  });

  it('still rejects a bad token when compat is enabled', async () => {
    const findByDomain = vi.fn();
    const guard = new RpRequestGuard(
      makeMerchants(findByDomain),
      makeConfig({ RP_PLATFORM_KILL_SWITCH_ENABLED: 'true', OS_RP_TOKEN: 'expected' }),
    );

    await expect(
      guard.canActivate(makeCtx({ ...headers, 'x-shopify-access-token': 'wrong' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('still requires X-Store when compat is enabled', async () => {
    const guard = new RpRequestGuard(
      makeMerchants(vi.fn()),
      makeConfig({ RP_PLATFORM_KILL_SWITCH_ENABLED: 'true', OS_RP_TOKEN: 'tok' }),
    );

    await expect(
      guard.canActivate(makeCtx({ 'x-shopify-access-token': 'tok', 'x-store': undefined })),
    ).rejects.toThrow(BadRequestException);
  });
});
