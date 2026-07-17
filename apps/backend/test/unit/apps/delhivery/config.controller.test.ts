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

function makeController(overrides: { testConnection?: unknown; syncWarehouse?: unknown } = {}) {
  const config = {
    getByMerchantId: vi.fn(async () => savedConfig),
    upsert: vi.fn(async () => savedConfig),
  } as unknown as DelhiveryConfigService;
  const sdk = {
    testConnection: overrides.testConnection ?? vi.fn(async () => ({ ok: true, status: 200 })),
    syncWarehouse:
      overrides.syncWarehouse ??
      vi.fn(async () => ({ ok: true, status: 'created', message: 'A new client warehouse has been created' })),
  } as unknown as DelhiverySdkService;
  return { controller: new DelhiveryConfigController(config, sdk), config, sdk };
}

describe('DelhiveryConfigController', () => {
  it('GET config masks the token — plaintext never leaves the backend', async () => {
    const { controller } = makeController();
    const res = await controller.get(merchant);

    expect(JSON.stringify(res)).not.toContain('dlv-secret-token-xyz');
    expect(res.apiTokenMasked).toBe('••••-xyz');
    expect(res.hasApiToken).toBe(true);
    expect((res as Record<string, unknown>).apiToken).toBeUndefined();
  });

  it('config.save.registersWarehouse — PUT upserts then registers the warehouse', async () => {
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

    expect(config.upsert).toHaveBeenCalledWith('mer_1', expect.objectContaining({ gstin: savedConfig.gstin }));
    expect(sdk.syncWarehouse).toHaveBeenCalledWith('mer_1');
    expect(res.warehouseRegistered).toBe(true);
    expect(res.warehouseStatus).toBe('created');
    // Delhivery's own message is passed through, not a hardcoded string.
    expect(res.warehouseMessage).toBe('A new client warehouse has been created');
    expect(JSON.stringify(res)).not.toContain('dlv-secret-token-xyz');
  });

  it('config.save.surfacesUpdatedStatus — syncWarehouse "updated" result + carrier message flow through', async () => {
    const syncWarehouse = vi.fn(async () => ({
      ok: true,
      status: 'updated',
      message: 'Client warehouse updated successfully',
    }));
    const { controller, sdk } = makeController({ syncWarehouse });
    const res = await controller.update(merchant, {
      apiToken: savedConfig.apiToken,
      pickupLocationName: savedConfig.pickupLocationName,
      pickupPincode: savedConfig.pickupPincode,
      pickupPhone: savedConfig.pickupPhone,
      pickupAddress: savedConfig.pickupAddress,
      gstin: savedConfig.gstin,
      defaultBox: savedConfig.defaultBox,
    });
    expect(sdk.syncWarehouse).toHaveBeenCalledWith('mer_1');
    expect(res.warehouseStatus).toBe('updated');
    expect(res.warehouseMessage).toBe('Client warehouse updated successfully');
  });

  it('config.test.ok — POST test proxies a valid token check', async () => {
    const { controller } = makeController();
    await expect(controller.test(merchant)).resolves.toEqual({ ok: true, status: 200 });
  });

  it('config.test.invalid401 — a bad token reports ok:false with 401', async () => {
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
