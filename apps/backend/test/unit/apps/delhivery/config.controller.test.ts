import { NotFoundException } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { describe, expect, it, vi } from 'vitest';
import { DelhiveryConfigController } from '../../../../src/modules/delhivery/config/config.controller';
import type { DelhiveryConfigService } from '../../../../src/modules/delhivery/config/config.service';
import type { DelhiverySdkService } from '../../../../src/modules/delhivery/sdk/sdk.service';

const merchant = { id: 'mer_1', isActive: true } as unknown as Merchant;

const savedConfig = {
  apiToken: 'dlv-secret-token-xyz',
  pickupLocationName: 'Main Warehouse',
  pickupPincode: '122001',
  pickupPhone: '9876543210',
  pickupAddress: 'Plot 5, Industrial Area',
  pickupCity: 'Gurgaon',
  gstin: '29ABCDE1234F1Z5',
  pickupCutoff: '10:00',
  awbTrigger: 'auto' as const,
  defaultBox: { l: 10, b: 12, h: 8 },
  enabled: true,
};

function makeController(
  overrides: { testConnection?: unknown; syncWarehouse?: unknown; getByMerchantId?: unknown } = {},
) {
  const config = {
    getByMerchantId: overrides.getByMerchantId ?? vi.fn(async () => savedConfig),
    upsert: vi.fn(async () => savedConfig),
  } as unknown as DelhiveryConfigService;
  const sdk = {
    testConnection: overrides.testConnection ?? vi.fn(async () => ({ ok: true, status: 200 })),
    syncWarehouse:
      overrides.syncWarehouse ??
      vi.fn(async () => ({
        ok: true,
        status: 'created',
        message: 'A new client warehouse has been created',
      })),
  } as unknown as DelhiverySdkService;
  return { controller: new DelhiveryConfigController(config, sdk), config, sdk };
}

describe('DelhiveryConfigController', () => {
  it('GET config masks the token: plaintext never leaves the backend', async () => {
    const { controller } = makeController();
    const res = await controller.get(merchant);

    expect(JSON.stringify(res)).not.toContain('dlv-secret-token-xyz');
    expect(res.apiTokenMasked).toBe('••••-xyz');
    expect(res.hasApiToken).toBe(true);
    expect((res as Record<string, unknown>).apiToken).toBeUndefined();
  });

  it('config.save.noCarrierCall: PUT only persists, syncWarehouse is never called', async () => {
    const { controller, config, sdk } = makeController();
    const res = await controller.update(merchant, {
      apiToken: savedConfig.apiToken,
      pickupLocationName: savedConfig.pickupLocationName,
      pickupPincode: savedConfig.pickupPincode,
      pickupPhone: savedConfig.pickupPhone,
      pickupAddress: savedConfig.pickupAddress,
      gstin: savedConfig.gstin,
      defaultBox: savedConfig.defaultBox,
    });

    expect(config.upsert).toHaveBeenCalledWith(
      'mer_1',
      expect.objectContaining({ gstin: savedConfig.gstin }),
    );
    expect(sdk.syncWarehouse).not.toHaveBeenCalled();
    // The saved config no longer carries any warehouse outcome.
    expect(res).not.toHaveProperty('warehouseStatus');
    expect(res).not.toHaveProperty('warehouseMessage');
    expect(res.apiTokenMasked).toBe('••••-xyz');
    expect(JSON.stringify(res)).not.toContain('dlv-secret-token-xyz');
  });

  it('warehouse.register: POST warehouse syncs and passes the carrier message through', async () => {
    const { controller, config, sdk } = makeController();
    const res = await controller.registerWarehouse(merchant);

    // A config row must exist before the carrier is touched.
    expect(config.getByMerchantId).toHaveBeenCalledWith('mer_1');
    expect(sdk.syncWarehouse).toHaveBeenCalledWith('mer_1');
    // Delhivery's own message is passed through, not a hardcoded string.
    expect(res).toEqual({
      warehouseStatus: 'created',
      warehouseMessage: 'A new client warehouse has been created',
    });
  });

  it('warehouse.register.updated: the "updated" status + carrier message flow through', async () => {
    const syncWarehouse = vi.fn(async () => ({
      ok: true,
      status: 'updated',
      message: 'Client warehouse updated successfully',
    }));
    const { controller, sdk } = makeController({ syncWarehouse });
    const res = await controller.registerWarehouse(merchant);
    expect(sdk.syncWarehouse).toHaveBeenCalledWith('mer_1');
    expect(res.warehouseStatus).toBe('updated');
    expect(res.warehouseMessage).toBe('Client warehouse updated successfully');
  });

  it('warehouse.register.failed: an unreachable carrier is reported, not thrown', async () => {
    const syncWarehouse = vi.fn(async () => ({
      ok: false,
      status: 'failed',
      message: 'Could not reach Delhivery to register the warehouse.',
    }));
    const { controller } = makeController({ syncWarehouse });
    const res = await controller.registerWarehouse(merchant);
    expect(res.warehouseStatus).toBe('failed');
    expect(res.warehouseMessage).toBe('Could not reach Delhivery to register the warehouse.');
  });

  it('warehouse.register.requiresConfig: no config row means 404 before any carrier call', async () => {
    const getByMerchantId = vi.fn(async () => {
      throw new NotFoundException({ message: 'no delhivery config for merchant' });
    });
    const { controller, sdk } = makeController({ getByMerchantId });
    await expect(controller.registerWarehouse(merchant)).rejects.toBeInstanceOf(NotFoundException);
    expect(sdk.syncWarehouse).not.toHaveBeenCalled();
  });

  it('config.test.ok: POST test proxies a valid token check', async () => {
    const { controller } = makeController();
    await expect(controller.test(merchant)).resolves.toEqual({ ok: true, status: 200 });
  });

  it('config.test.invalid401: a bad token reports ok:false with 401', async () => {
    const { controller } = makeController({
      testConnection: vi.fn(async () => ({ ok: false, status: 401 })),
    });
    await expect(controller.test(merchant)).resolves.toEqual({ ok: false, status: 401 });
  });

  it('defaults returns the carrier defaults for the admin form', () => {
    const { controller } = makeController();
    expect(controller.defaults()).toEqual({
      pickupCutoff: '10:00',
      awbTrigger: 'auto',
      defaultBox: { l: 10, b: 10, h: 10 },
    });
  });
});
