import { describe, expect, it } from 'vitest';
import { buildPackage } from '../../../../src/modules/delhivery/shipments/build-package';

const defaultBox = { l: 10, b: 10, h: 10 };

const productWithDims = {
  id: 'p1',
  title: 'Tee',
  grams: 250,
  hs_code: '6109',
  metafields: [
    { key: 'length_cm', value: '30' },
    { key: 'breadth_cm', value: 20 },
    { key: 'height_cm', value: 4 },
  ],
};

const productNoDims = { id: 'p2', title: 'Mug', grams: 400, metafields: [] };

describe('buildPackage (worker.paid.buildsPackage)', () => {
  it('uses hs_code + product dimension metafields for L/B/H and sums grams', () => {
    const order = { line_items: [{ product_id: 'p1', quantity: 2, grams: 250, title: 'Tee' }] };
    const pkg = buildPackage(order, [productWithDims], defaultBox);

    expect(pkg.dims).toEqual({ l: 30, b: 20, h: 4 });
    expect(pkg.hsnCode).toBe('6109');
    expect(pkg.weightGrams).toBe(500);
    // grams → kg for the Delhivery contract.
    expect(pkg.weightKg).toBe(0.5);
    expect(pkg.quantity).toBe(2);
  });

  it('falls back to the merchant default box when no product carries complete dims', () => {
    const order = { line_items: [{ product_id: 'p2', quantity: 1 }] };
    const pkg = buildPackage(order, [productNoDims], defaultBox);

    expect(pkg.dims).toEqual(defaultBox);
    expect(pkg.weightGrams).toBe(400); // product grams fallback per item
  });

  it('takes the per-axis max across dimensioned products in a multi-item order', () => {
    const p3 = {
      id: 'p3',
      grams: 100,
      metafields: [
        { key: 'length_cm', value: 12 },
        { key: 'breadth_cm', value: 40 },
        { key: 'height_cm', value: 2 },
      ],
    };
    const order = {
      line_items: [
        { product_id: 'p1', quantity: 1 },
        { product_id: 'p3', quantity: 1 },
      ],
    };
    const pkg = buildPackage(order, [productWithDims, p3], defaultBox);
    expect(pkg.dims).toEqual({ l: 30, b: 40, h: 4 });
  });

  it('floors the weight at 500g when nothing carries grams', () => {
    const order = { line_items: [{ product_id: 'px', quantity: 1 }] };
    const pkg = buildPackage(order, [], defaultBox);
    expect(pkg.weightGrams).toBe(500);
    expect(pkg.weightKg).toBe(0.5);
  });
});
