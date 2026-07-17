import { describe, expect, it, vi } from 'vitest';
import type { DelhiverySdkService } from '../../../../src/modules/delhivery/sdk/sdk.service';
import { DelhiveryServiceabilityService } from '../../../../src/modules/delhivery/serviceability/serviceability.service';

function makeService(
  checkServiceability: unknown,
  expectedTatBand: unknown = vi.fn(async () => null),
) {
  const sdk = { checkServiceability, expectedTatBand } as unknown as DelhiverySdkService;
  return { service: new DelhiveryServiceabilityService(sdk), sdk };
}

describe('DelhiveryServiceabilityService', () => {
  it('serviceability.returnsFields — serviceable/cod/edd/carrier from the Delhivery response', async () => {
    const { service } = makeService(
      vi.fn(async () => ({ serviceable: true, codAvailable: true, prepaidAvailable: true })),
    );
    const res = await service.check('mer_1', '560001');

    expect(res).toEqual({
      serviceable: true,
      cod_available: true,
      edd_min: 2,
      edd_max: 5,
      edd_estimated: true,
      carrier: 'DELHIVERY',
    });
  });

  it('edd falls back to a flagged estimate when the TAT lookup is unavailable', async () => {
    // expectedTatBand → null (no pickup pincode / TAT down): use the estimate.
    const { service } = makeService(
      vi.fn(async () => ({ serviceable: true, codAvailable: true, prepaidAvailable: true })),
      vi.fn(async () => null),
    );
    const res = await service.check('mer_1', '110001');
    expect(res).toMatchObject({ edd_min: 2, edd_max: 5, edd_estimated: true });
  });

  it('uses the real Expected-TAT band when available (edd_estimated=false)', async () => {
    const { service } = makeService(
      vi.fn(async () => ({ serviceable: true, codAvailable: true, prepaidAvailable: true })),
      vi.fn(async () => ({ min: 3, max: 5 })),
    );
    const res = await service.check('mer_1', '400001');
    expect(res).toMatchObject({
      serviceable: true,
      edd_min: 3,
      edd_max: 5,
      edd_estimated: false,
    });
  });

  it('caches and returns the real EDD band on a hit (checkServiceability + TAT queried once)', async () => {
    const check = vi.fn(async () => ({ serviceable: true, codAvailable: true, prepaidAvailable: true }));
    const tat = vi.fn(async () => ({ min: 3, max: 5 }));
    const { service } = makeService(check, tat);

    const a = await service.check('mer_1', '400001');
    const b = await service.check('mer_1', '400001');

    expect(a).toMatchObject({ edd_min: 3, edd_max: 5, edd_estimated: false });
    expect(b).toEqual(a);
    expect(check).toHaveBeenCalledTimes(1);
    expect(tat).toHaveBeenCalledTimes(1);
  });

  it('does not query TAT for a non-serviceable pincode', async () => {
    const tat = vi.fn(async () => ({ min: 3, max: 5 }));
    const { service } = makeService(
      vi.fn(async () => ({ serviceable: false, codAvailable: false, prepaidAvailable: false })),
      tat,
    );
    await service.check('mer_1', '999999');
    expect(tat).not.toHaveBeenCalled();
  });

  it('non-serviceable pincode reports cod_available=false too', async () => {
    const { service } = makeService(
      vi.fn(async () => ({ serviceable: false, codAvailable: false, prepaidAvailable: false })),
    );
    const res = await service.check('mer_1', '999999');
    expect(res.serviceable).toBe(false);
    expect(res.cod_available).toBe(false);
  });

  it('serviceability.cacheHit — 2nd call within 6h never re-hits Delhivery', async () => {
    const check = vi.fn(async () => ({ serviceable: true, codAvailable: false, prepaidAvailable: true }));
    const { service } = makeService(check);

    const a = await service.check('mer_1', '560001');
    const b = await service.check('mer_1', '560001');

    expect(check).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });

  it('cache is keyed per (merchant, pincode)', async () => {
    const check = vi.fn(async () => ({ serviceable: true, codAvailable: true, prepaidAvailable: true }));
    const { service } = makeService(check);

    await service.check('mer_1', '560001');
    await service.check('mer_1', '110001');
    await service.check('mer_2', '560001');

    expect(check).toHaveBeenCalledTimes(3);
  });

  it('serviceability.failOpen — Delhivery down → serviceable:true with generic EDD, uncached', async () => {
    const check = vi
      .fn()
      .mockRejectedValueOnce(new Error('delhivery responded 503'))
      .mockResolvedValueOnce({ serviceable: false, codAvailable: false, prepaidAvailable: false });
    const { service } = makeService(check);

    const degraded = await service.check('mer_1', '560001');
    expect(degraded).toMatchObject({
      serviceable: true,
      cod_available: true,
      edd_min: 3,
      edd_max: 7,
      edd_estimated: true,
      degraded: true,
    });

    // The degraded verdict was NOT cached — recovery is immediate.
    const healthy = await service.check('mer_1', '560001');
    expect(check).toHaveBeenCalledTimes(2);
    expect(healthy.serviceable).toBe(false);
    expect(healthy.degraded).toBeUndefined();
  });
});
