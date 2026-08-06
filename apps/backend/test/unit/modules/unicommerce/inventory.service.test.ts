import { describe, expect, it, vi } from 'vitest';
import { UcInventoryService } from '../../../../src/modules/unicommerce/services/inventory.service';

interface FakeRow {
  merchantId: string;
  variantId: string;
  facilityCode: string;
  sku: string;
  inventory: number;
}

/** Fake Kysely handle backing `uc_variant_inventory`'s upsert + sum query. */
function fakeHandle(seed: FakeRow[] = []) {
  const rows = [...seed];
  const db = {
    insertInto: (_table: string) => ({
      values: (v: FakeRow) => ({
        onDuplicateKeyUpdate: (patch: Partial<FakeRow>) => ({
          execute: async () => {
            const existing = rows.find((r) => r.merchantId === v.merchantId && r.variantId === v.variantId && r.facilityCode === v.facilityCode);
            if (existing) Object.assign(existing, patch);
            else rows.push({ ...v });
          },
        }),
      }),
    }),
    selectFrom: (_table: string) => {
      const filters: Array<(row: FakeRow) => boolean> = [];
      const builder = {
        select: (_fn: unknown) => builder,
        where: (col: string, _op: string, val: unknown) => {
          filters.push((row) => (row as unknown as Record<string, unknown>)[col] === val);
          return builder;
        },
        executeTakeFirst: async () => {
          const total = rows.filter((r) => filters.every((f) => f(r))).reduce((s, r) => s + r.inventory, 0);
          return { total };
        },
      };
      return builder;
    },
    fn: { sum: (_col: string) => ({ as: (_alias: string) => 'total' }) },
  };
  return { handle: { db }, rows };
}

describe('UcInventoryService.apply', () => {
  it("uses UC's variantId directly as the Ratio variant_id — no SKU-cache resolution", async () => {
    const ratio = { updateVariantInventory: vi.fn().mockResolvedValue(undefined) };
    const { handle } = fakeHandle();
    const svc = new UcInventoryService(ratio as never, handle as never);

    // UC's real POST /updateInventory contract: `variantId` IS our own
    // Ratio variant id, confirmed directly — not a SKU needing lookup.
    const result = await svc.apply('m1', [{ productId: 'P1', variantId: 'ratio-variant-1', inventory: '42' }]);

    expect(ratio.updateVariantInventory).toHaveBeenCalledWith('m1', 'ratio-variant-1', 42);
    expect(result.status).toBe('SUCCESS');
    expect(result.failedProductList).toHaveLength(0);
  });

  it('sums per-facility quantities in uc_variant_inventory before writing the total to Ratio', async () => {
    const ratio = { updateVariantInventory: vi.fn().mockResolvedValue(undefined) };
    const { handle, rows } = fakeHandle([
      { merchantId: 'm1', variantId: 'v1', facilityCode: 'DEL01', sku: 'SKU-1', inventory: 5 },
    ]);
    const svc = new UcInventoryService(ratio as never, handle as never);

    // Bangalore facility just reported 8 — Delhi's existing 5 must still be
    // counted, giving a combined total of 13, not just the new call's 8.
    await svc.apply('m1', [{ productId: 'P1', variantId: 'v1', inventory: '8', facilityCode: 'BLR01' }]);

    expect(ratio.updateVariantInventory).toHaveBeenCalledWith('m1', 'v1', 13);
    expect(rows).toContainEqual(
      expect.objectContaining({ merchantId: 'm1', variantId: 'v1', facilityCode: 'BLR01', sku: 'v1', inventory: 8 }),
    );
  });

  it('reports a real Ratio-side failure (e.g. unknown variant) as a failed item, not a thrown error', async () => {
    const ratio = { updateVariantInventory: vi.fn().mockRejectedValue(new Error('variant not found')) };
    const { handle } = fakeHandle();
    const svc = new UcInventoryService(ratio as never, handle as never);

    const result = await svc.apply('m1', [{ productId: 'P1', variantId: 'unknown-variant', inventory: '10' }]);

    expect(result.status).toBe('PARTIAL_SUCCESS');
    expect(result.failedProductList).toEqual([{ productId: 'P1', message: 'variant not found' }]);
  });
});
