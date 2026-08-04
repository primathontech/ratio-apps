import { describe, expect, it, vi } from 'vitest';
import { UcInventoryController } from '../../../../src/modules/unicommerce/controllers/inventory.controller';

function enabledFlags() {
  return { isEnabled: vi.fn().mockResolvedValue(true) };
}

describe('UcInventoryController.update', () => {
  it('applies the inventory list and returns the result', async () => {
    const inventory = {
      apply: vi.fn().mockResolvedValue({ status: 'SUCCESS', failedProductList: [] }),
    };
    const controller = new UcInventoryController(
      inventory as never,
      { record: vi.fn() } as never,
      enabledFlags() as never,
    );

    const result = await controller.update({ ucMerchantId: 'm1' } as never, {
      inventoryList: [{ productId: 'p1', variantId: 'v1', inventory: '10' }],
    });

    expect(inventory.apply).toHaveBeenCalledWith('m1', [
      { productId: 'p1', variantId: 'v1', inventory: '10' },
    ]);
    expect(result).toEqual({ status: 'SUCCESS', failedProductList: [] });
  });

  // Fix 2: an event-log write failure must never turn this real result into
  // a rejected request handler.
  it('still returns the correct result when eventLog.record() rejects (Fix 2)', async () => {
    const inventory = {
      apply: vi.fn().mockResolvedValue({ status: 'SUCCESS', failedProductList: [] }),
    };
    const eventLog = { record: vi.fn().mockRejectedValue(new Error('transient DB error')) };
    const controller = new UcInventoryController(
      inventory as never,
      eventLog as never,
      enabledFlags() as never,
    );

    const result = await controller.update({ ucMerchantId: 'm1' } as never, {
      inventoryList: [{ productId: 'p1', variantId: 'v1', inventory: '10' }],
    });

    expect(result).toEqual({ status: 'SUCCESS', failedProductList: [] });
  });

  // TRD §6: inventory_sync flag off → accept-and-no-op, never hard-reject.
  it('returns a no-op SUCCESS without touching the inventory service when inventory_sync is disabled', async () => {
    const inventory = { apply: vi.fn() };
    const flags = { isEnabled: vi.fn().mockResolvedValue(false) };
    const controller = new UcInventoryController(
      inventory as never,
      { record: vi.fn() } as never,
      flags as never,
    );

    const result = await controller.update({ ucMerchantId: 'm1' } as never, {
      inventoryList: [{ productId: 'p1', variantId: 'v1', inventory: '10' }],
    });

    expect(flags.isEnabled).toHaveBeenCalledWith('inventory_sync', 'm1');
    expect(inventory.apply).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'SUCCESS', failedProductList: [] });
  });
});
