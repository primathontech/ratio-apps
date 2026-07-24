import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RpInventoryService } from './inventory.service';
import type { RpRatioClientService } from '../ratio-client/ratio-client.service';
import type { RpIdMappingService } from '../id-mapping/id-mapping.service';

/**
 * Shopify's inventory_levels/adjust takes a DELTA; OS's own variant inventory endpoint
 * sets an ABSOLUTE quantity. This service must read the variant's current quantity,
 * add the delta, then write the sum back — never pass the delta straight through.
 */
function makeService(opts: {
  resolvedRealId?: string | null;
  getVariant?: ReturnType<typeof vi.fn>;
  setVariantInventory?: ReturnType<typeof vi.fn>;
}) {
  const resolveRealId = vi.fn().mockResolvedValue(opts.resolvedRealId ?? null);
  const getVariant = opts.getVariant ?? vi.fn().mockResolvedValue({ inventory_quantity: 10 });
  const setVariantInventory = opts.setVariantInventory ?? vi.fn().mockResolvedValue({});
  const ratioClient = { getVariant, setVariantInventory } as unknown as RpRatioClientService;
  const idMapping = { resolveRealId } as unknown as RpIdMappingService;

  const service = new RpInventoryService(ratioClient, idMapping);
  return { service, ratioClient, idMapping, resolveRealId, getVariant, setVariantInventory };
}

describe('RpInventoryService.adjustInventoryLevel', () => {
  it('resolves the hashed inventory_item_id via id-mapping before reading/writing OS', async () => {
    const { service, resolveRealId, getVariant } = makeService({ resolvedRealId: 'real-variant-1' });

    await service.adjustInventoryLevel('m1', {
      location_id: 1,
      inventory_item_id: 42020556374094,
      available_adjustment: 3,
    });

    expect(resolveRealId).toHaveBeenCalledWith('variant', '42020556374094');
    expect(getVariant).toHaveBeenCalledWith('m1', 'real-variant-1');
  });

  it('falls back to the raw inventory_item_id when no mapping is found', async () => {
    const { service, getVariant } = makeService({ resolvedRealId: null });

    await service.adjustInventoryLevel('m1', { inventory_item_id: 42, available_adjustment: 1 });

    expect(getVariant).toHaveBeenCalledWith('m1', '42');
  });

  it('adds the delta to the current quantity and writes the sum (not the delta) back', async () => {
    const { service, setVariantInventory } = makeService({
      resolvedRealId: 'real-variant-1',
      getVariant: vi.fn().mockResolvedValue({ inventory_quantity: 10 }),
    });

    await service.adjustInventoryLevel('m1', { inventory_item_id: 1, available_adjustment: 3 });

    expect(setVariantInventory).toHaveBeenCalledWith('m1', 'real-variant-1', 13);
  });

  it('supports a negative delta (exchange-reserve decrementing stock)', async () => {
    const { service, setVariantInventory } = makeService({
      resolvedRealId: 'real-variant-1',
      getVariant: vi.fn().mockResolvedValue({ inventory_quantity: 10 }),
    });

    await service.adjustInventoryLevel('m1', { inventory_item_id: 1, available_adjustment: -4 });

    expect(setVariantInventory).toHaveBeenCalledWith('m1', 'real-variant-1', 6);
  });

  it('falls back to inventory.quantity when inventory_quantity is absent (canonical Variant schema shape)', async () => {
    const { service, setVariantInventory } = makeService({
      resolvedRealId: 'real-variant-1',
      getVariant: vi.fn().mockResolvedValue({ inventory: { quantity: 5 } }),
    });

    await service.adjustInventoryLevel('m1', { inventory_item_id: 1, available_adjustment: 2 });

    expect(setVariantInventory).toHaveBeenCalledWith('m1', 'real-variant-1', 7);
  });

  it('returns a Shopify-shape inventory_level object', async () => {
    const { service } = makeService({
      resolvedRealId: 'real-variant-1',
      getVariant: vi.fn().mockResolvedValue({ inventory_quantity: 10 }),
    });

    const result = await service.adjustInventoryLevel('m1', {
      location_id: 99,
      inventory_item_id: 1,
      available_adjustment: 3,
    });

    expect(result).toEqual({
      inventory_level: { inventory_item_id: 1, location_id: 99, available: 13 },
    });
  });

  it('throws BadRequestException when inventory_item_id is missing', async () => {
    const { service } = makeService({});

    await expect(service.adjustInventoryLevel('m1', { available_adjustment: 1 })).rejects.toThrow(
      BadRequestException,
    );
  });
});
