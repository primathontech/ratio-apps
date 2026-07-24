import { describe, expect, it, vi, afterEach } from 'vitest';
import { UnauthorizedException, BadGatewayException } from '@nestjs/common';
import { RpAdminController } from '../../../../src/modules/rp/admin/rp-admin.controller';

const MERCHANT = {
  merchantId: 'm1',
  domain: 'store.dev.gokwik.io',
  active: true,
  rpRegistered: true,
};

function makeReq(headers: Record<string, string | undefined> = {}, body: Record<string, unknown> = {}) {
  return { headers, body } as never;
}

function makeController(overrides: {
  findByMerchantId?: ReturnType<typeof vi.fn>;
  setMerchantActiveStatus?: ReturnType<typeof vi.fn>;
  updateDomain?: ReturnType<typeof vi.fn>;
  setRpRegistered?: ReturnType<typeof vi.fn>;
  syncCatalog?: ReturnType<typeof vi.fn>;
  configValues?: Record<string, string>;
} = {}) {
  const merchants = {
    findByMerchantId: overrides.findByMerchantId ?? vi.fn().mockResolvedValue(MERCHANT),
    updateDomain: overrides.updateDomain ?? vi.fn().mockResolvedValue(undefined),
    setRpRegistered: overrides.setRpRegistered ?? vi.fn().mockResolvedValue(undefined),
  };
  const webhooks = {
    setMerchantActiveStatus: overrides.setMerchantActiveStatus ?? vi.fn().mockResolvedValue(undefined),
  };
  const values: Record<string, string> = {
    RP_BASE_URL: 'https://devapi.returnprime.co',
    OS_RP_TOKEN: 'rp-test-token',
    ...overrides.configValues,
  };
  const config = { get: (key: string) => values[key] };
  const catalogSync = { syncCatalog: overrides.syncCatalog ?? vi.fn().mockResolvedValue(undefined) };
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

  // Regression: `registered` used to be inferred from `domain !== merchantId`, which a
  // failed os-install could satisfy anyway (domain was updated before RP was ever
  // called). It must now come from the explicit rpRegistered flag, not domain.
  it('reports registered:false when rpRegistered is false, even if domain differs from merchantId', async () => {
    const findByMerchantId = vi.fn().mockResolvedValue({
      merchantId: 'm1',
      domain: 'a-real-domain.gokwik.co', // differs from merchantId
      active: true,
      rpRegistered: false, // but RP never actually confirmed
    });
    const controller = makeController({ findByMerchantId });

    const result = await controller.me(makeReq({ authorization: 'Bearer m1' }));

    expect(result.registered).toBe(false);
  });
});

describe('RpAdminController.register', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('on a genuine 2xx from RP: persists domain + rpRegistered together, triggers catalog sync, returns registered:true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ status: 'ok', message: 'installed' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const updateDomain = vi.fn().mockResolvedValue(undefined);
    const setRpRegistered = vi.fn().mockResolvedValue(undefined);
    const syncCatalog = vi.fn().mockResolvedValue(undefined);
    const controller = makeController({ updateDomain, setRpRegistered, syncCatalog });

    const result = await controller.register(
      makeReq({ authorization: 'Bearer m1' }, { store_domain: 'real-store.gokwik.co' }),
    );

    expect(updateDomain).toHaveBeenCalledWith('m1', 'real-store.gokwik.co');
    expect(setRpRegistered).toHaveBeenCalledWith('m1', true);
    expect(syncCatalog).toHaveBeenCalledWith('m1');
    expect(result).toMatchObject({ registered: true, domain: 'real-store.gokwik.co' });
  });

  it('does NOT persist domain if it is unchanged from the existing merchant domain', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({}) }),
    );
    const updateDomain = vi.fn().mockResolvedValue(undefined);
    const setRpRegistered = vi.fn().mockResolvedValue(undefined);
    const controller = makeController({ updateDomain, setRpRegistered });

    // no store_domain in body -> falls back to merchant.domain, unchanged
    await controller.register(makeReq({ authorization: 'Bearer m1' }));

    expect(updateDomain).not.toHaveBeenCalled();
    expect(setRpRegistered).toHaveBeenCalledWith('m1', true);
  });

  // THE regression test: RP rejects (non-2xx) -> nothing gets persisted, so a
  // subsequent me() call cannot show registered:true.
  it('when RP rejects (non-2xx): persists NOTHING, throws with side:return-prime and RP\'s own message', async () => {
    const rpErrorBody = { status: false, messageCode: 'GLOBAL_E2', message: 'Store already has a pending install' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 409, json: () => Promise.resolve(rpErrorBody) }),
    );
    const updateDomain = vi.fn().mockResolvedValue(undefined);
    const setRpRegistered = vi.fn().mockResolvedValue(undefined);
    const controller = makeController({ updateDomain, setRpRegistered });

    await expect(
      controller.register(makeReq({ authorization: 'Bearer m1' }, { store_domain: 'real-store.gokwik.co' })),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        side: 'return-prime',
        reason: 'rejected',
        message: expect.stringContaining('Store already has a pending install'),
      }),
    });

    expect(updateDomain).not.toHaveBeenCalled();
    expect(setRpRegistered).not.toHaveBeenCalled();
  });

  it('when RP is unreachable (fetch throws): persists NOTHING, throws with side:adapter/network_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const updateDomain = vi.fn().mockResolvedValue(undefined);
    const setRpRegistered = vi.fn().mockResolvedValue(undefined);
    const controller = makeController({ updateDomain, setRpRegistered });

    await expect(
      controller.register(makeReq({ authorization: 'Bearer m1' })),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ side: 'rp-adapter', reason: 'network_error' }),
    });

    expect(updateDomain).not.toHaveBeenCalled();
    expect(setRpRegistered).not.toHaveBeenCalled();
  });

  it('when RP responds 2xx but with unparseable JSON: persists NOTHING, throws with side:adapter/invalid_response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('Unexpected token')),
      }),
    );
    const updateDomain = vi.fn().mockResolvedValue(undefined);
    const setRpRegistered = vi.fn().mockResolvedValue(undefined);
    const controller = makeController({ updateDomain, setRpRegistered });

    await expect(
      controller.register(makeReq({ authorization: 'Bearer m1' })),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ side: 'rp-adapter', reason: 'invalid_response' }),
    });

    expect(updateDomain).not.toHaveBeenCalled();
    expect(setRpRegistered).not.toHaveBeenCalled();
  });

  it('rejects with BadGatewayException type on RP rejection (not just a generic Error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) }),
    );
    const controller = makeController();

    await expect(controller.register(makeReq({ authorization: 'Bearer m1' }))).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  // error_code is the one extra field that actually survives GlobalExceptionFilter
  // (it forwards message/error_code/details only — side/reason/rp get dropped before
  // reaching the client, so they're useful for logs and these unit tests, not the
  // wire response). Confirm each failure mode sets a distinct, stable code.
  it('sets a distinct error_code per failure mode, so the client can tell them apart even though side/reason do not survive the response filter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) }),
    );
    const rejectedController = makeController();
    await expect(rejectedController.register(makeReq({ authorization: 'Bearer m1' }))).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'RP_REJECTED' }),
    });
    vi.unstubAllGlobals();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const unreachableController = makeController();
    await expect(unreachableController.register(makeReq({ authorization: 'Bearer m1' }))).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'RP_UNREACHABLE' }),
    });
  });

  it('logs and rejects with RP_NOT_CONFIGURED when RP_BASE_URL/OS_RP_TOKEN are missing — before ever calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = makeController({ configValues: { RP_BASE_URL: '', OS_RP_TOKEN: '' } });

    await expect(controller.register(makeReq({ authorization: 'Bearer m1' }))).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'RP_NOT_CONFIGURED', side: 'rp-adapter' }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
