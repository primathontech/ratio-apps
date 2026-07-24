import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { RpAdminController } from '../../../../src/modules/rp/admin/rp-admin.controller';

const MERCHANT = { merchantId: 'm1', domain: 'store.dev.gokwik.io', active: true };

function makeReq(headers: Record<string, string | undefined> = {}) {
  return { headers, body: {} } as never;
}

function makeController(overrides: {
  findByMerchantId?: ReturnType<typeof vi.fn>;
  setMerchantActiveStatus?: ReturnType<typeof vi.fn>;
} = {}) {
  const merchants = {
    findByMerchantId: overrides.findByMerchantId ?? vi.fn().mockResolvedValue(MERCHANT),
  };
  const webhooks = {
    setMerchantActiveStatus: overrides.setMerchantActiveStatus ?? vi.fn().mockResolvedValue(undefined),
  };
  const config = { get: () => undefined };
  const catalogSync = { syncCatalog: vi.fn().mockResolvedValue(undefined) };
  return new RpAdminController(
    merchants as never,
    config as never,
    catalogSync as never,
    webhooks as never,
  );
}

describe('RpAdminController.setStatus — merchant self-service pause/resume', () => {
  it('resolves merchant from the Bearer token and relays active:false to setMerchantActiveStatus', async () => {
    const setMerchantActiveStatus = vi.fn().mockResolvedValue(undefined);
    const controller = makeController({ setMerchantActiveStatus });

    const result = await controller.setStatus(
      makeReq({ authorization: 'Bearer m1' }),
      { active: false },
    );

    expect(setMerchantActiveStatus).toHaveBeenCalledWith('m1', 'store.dev.gokwik.io', false);
    expect(result).toEqual({ active: false });
  });

  it('relays active:true when the merchant resumes', async () => {
    const setMerchantActiveStatus = vi.fn().mockResolvedValue(undefined);
    const controller = makeController({ setMerchantActiveStatus });

    const result = await controller.setStatus(
      makeReq({ authorization: 'Bearer m1' }),
      { active: true },
    );

    expect(setMerchantActiveStatus).toHaveBeenCalledWith('m1', 'store.dev.gokwik.io', true);
    expect(result).toEqual({ active: true });
  });

  it('treats a missing/undefined active body field as false', async () => {
    const setMerchantActiveStatus = vi.fn().mockResolvedValue(undefined);
    const controller = makeController({ setMerchantActiveStatus });

    await controller.setStatus(makeReq({ authorization: 'Bearer m1' }), {});

    expect(setMerchantActiveStatus).toHaveBeenCalledWith('m1', 'store.dev.gokwik.io', false);
  });

  it('rejects when there is no merchant session (no Bearer token / x-merchant-id)', async () => {
    const controller = makeController();

    await expect(controller.setStatus(makeReq(), { active: false })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects when the merchant is not installed', async () => {
    const findByMerchantId = vi.fn().mockResolvedValue(undefined);
    const controller = makeController({ findByMerchantId });

    await expect(
      controller.setStatus(makeReq({ authorization: 'Bearer unknown' }), { active: true }),
    ).rejects.toThrow(UnauthorizedException);
  });

  // The merchant must be able to resume even while paused — findByMerchantId (used to
  // resolve the session here) has no `active` filter, unlike RpRequestGuard's
  // findByDomain, which is what actually blocks /rp/shopify/* traffic while paused.
  it('still resolves a currently-inactive merchant (so they can flip themselves back on)', async () => {
    const findByMerchantId = vi.fn().mockResolvedValue({ ...MERCHANT, active: false });
    const setMerchantActiveStatus = vi.fn().mockResolvedValue(undefined);
    const controller = makeController({ findByMerchantId, setMerchantActiveStatus });

    const result = await controller.setStatus(
      makeReq({ authorization: 'Bearer m1' }),
      { active: true },
    );

    expect(setMerchantActiveStatus).toHaveBeenCalledWith('m1', 'store.dev.gokwik.io', true);
    expect(result).toEqual({ active: true });
  });
});

describe('RpAdminController.me', () => {
  it('returns the merchant active status alongside id/domain/registered', async () => {
    const findByMerchantId = vi.fn().mockResolvedValue(MERCHANT);
    const controller = makeController({ findByMerchantId });

    const result = await controller.me(makeReq({ authorization: 'Bearer m1' }));

    expect(result).toEqual({
      id: 'm1',
      domain: 'store.dev.gokwik.io',
      active: true,
      registered: true,
    });
  });
});
