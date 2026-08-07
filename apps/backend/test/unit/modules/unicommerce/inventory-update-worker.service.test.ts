import { describe, expect, it, vi } from 'vitest';
import { UcInventoryUpdateWorkerService } from '../../../../src/modules/unicommerce/services/inventory-update-worker.service';

describe('UcInventoryUpdateWorkerService.apply', () => {
  it('delegates a single-item list to the existing UcInventoryService.apply and returns its result on success', async () => {
    const inventory = {
      apply: vi.fn().mockResolvedValue({ status: 'SUCCESS', failedProductList: [] }),
    };
    const worker = new UcInventoryUpdateWorkerService(inventory as never);
    const payload = {
      productId: 'gid://shopify/Product/8123456789012',
      variantId: 'gid://shopify/Variant/4345678901234',
      inventory: '24',
      facilityCode: 'DEL-BLR-01',
    };

    const result = await worker.apply('m1', payload);

    expect(inventory.apply).toHaveBeenCalledWith('m1', [payload]);
    expect(result).toEqual({ status: 'SUCCESS', failedProductList: [] });
  });

  it("rethrows a failed item's message so the queue's retry ladder can classify it", async () => {
    const inventory = {
      apply: vi.fn().mockResolvedValue({
        status: 'PARTIAL_SUCCESS',
        failedProductList: [{ productId: 'p1', message: 'Ratio inventory update failed' }],
      }),
    };
    const worker = new UcInventoryUpdateWorkerService(inventory as never);

    await expect(
      worker.apply('m1', {
        productId: 'p1',
        variantId: 'v1',
        inventory: '24',
      }),
    ).rejects.toThrow('Ratio inventory update failed');
  });

  it("falls back to the generic message when a failed item carries none (conservatively recoverable)", async () => {
    const inventory = {
      apply: vi.fn().mockResolvedValue({
        status: 'PARTIAL_SUCCESS',
        failedProductList: [{ productId: 'p1', message: '' }],
      }),
    };
    const worker = new UcInventoryUpdateWorkerService(inventory as never);

    await expect(
      worker.apply('m1', { productId: 'p1', variantId: 'v1', inventory: '24' }),
    ).rejects.toThrow('Ratio inventory update failed');
  });

  it('passes through optional hsnCode/facilityCode fields unchanged', async () => {
    const inventory = {
      apply: vi.fn().mockResolvedValue({ status: 'SUCCESS', failedProductList: [] }),
    };
    const worker = new UcInventoryUpdateWorkerService(inventory as never);
    const payload = {
      productId: 'p1',
      variantId: 'v1',
      inventory: '5',
      hsnCode: '6109',
      facilityCode: 'DEL-BLR-01',
    };

    await worker.apply('m1', payload);

    expect(inventory.apply).toHaveBeenCalledWith('m1', [payload]);
  });
});
