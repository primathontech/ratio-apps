import { describe, expect, it } from 'vitest';
import {
  buildCatalogIdempotencyKey,
  mapProductForCatalog,
  parseProductPaiseToRupees,
} from '../../../../src/modules/clevertap/events/product-catalog.mapper';

const PRODUCT_ID = '10155084972338';
const productPayload: Record<string, unknown> = {
  id: PRODUCT_ID,
  title: 'Cotton T-Shirt',
  handle: 'cotton-t-shirt',
  status: 'active',
  currency: 'INR',
  price: 155900,
  image: { src: 'https://cdn.example.com/tshirt.jpg' },
  variants: [{ id: 'var_1', sku: 'TSHIRT-M-BLUE', price: 155900 }],
  updated_at: '2026-06-10T08:30:05.000Z',
};

describe('mapProductForCatalog — upsert', () => {
  it('maps products/create to an upsert keyed by product id', () => {
    const mapped = mapProductForCatalog('products/create', productPayload);
    expect(mapped?.operation).toBe('upsert');
    expect(mapped?.subjectId).toBe(PRODUCT_ID);
    expect(mapped?.item.id).toBe(PRODUCT_ID);
  });

  it('converts PAISE to RUPEES — 155900 paise → ₹1559 (NOT 155900)', () => {
    const mapped = mapProductForCatalog('products/update', productPayload);
    expect(mapped?.item.price).toBe(1559);
  });

  it('carries title, currency, image, handle, sku and availability', () => {
    const item = mapProductForCatalog('products/create', productPayload)?.item;
    expect(item?.name).toBe('Cotton T-Shirt');
    expect(item?.currency).toBe('INR');
    expect(item?.imageUrl).toBe('https://cdn.example.com/tshirt.jpg');
    expect(item?.handle).toBe('cotton-t-shirt');
    expect(item?.sku).toBe('TSHIRT-M-BLUE');
    expect(item?.available).toBe(true);
  });

  it('derives available=false for a non-active status', () => {
    const item = mapProductForCatalog('products/update', {
      ...productPayload,
      status: 'archived',
    })?.item;
    expect(item?.available).toBe(false);
  });

  it('falls back to the first variant price/sku and images[] when top level is absent', () => {
    const item = mapProductForCatalog('products/create', {
      id: PRODUCT_ID,
      title: 'No top-level price',
      images: [{ src: 'https://cdn.example.com/a.jpg' }],
      variants: [{ sku: 'SKU-1', price: 49900 }],
    })?.item;
    expect(item?.price).toBe(499);
    expect(item?.sku).toBe('SKU-1');
    expect(item?.imageUrl).toBe('https://cdn.example.com/a.jpg');
  });

  it('omits price when it is absent/unparseable rather than sending 0', () => {
    const item = mapProductForCatalog('products/create', {
      id: PRODUCT_ID,
      title: 'Priceless',
    })?.item;
    expect(item && 'price' in item).toBe(false);
  });

  it('defaults currency to INR when the payload omits it', () => {
    const item = mapProductForCatalog('products/create', {
      id: PRODUCT_ID,
      price: 100,
    })?.item;
    expect(item?.currency).toBe('INR');
  });
});

describe('mapProductForCatalog — remove & null contract', () => {
  it('maps products/delete to a remove carrying only the id', () => {
    const mapped = mapProductForCatalog('products/delete', { id: PRODUCT_ID });
    expect(mapped?.operation).toBe('remove');
    expect(mapped?.subjectId).toBe(PRODUCT_ID);
    expect(mapped?.item).toEqual({ id: PRODUCT_ID });
  });

  it('returns null when the payload has no product id (nothing to key on)', () => {
    expect(mapProductForCatalog('products/create', { title: 'no id' })).toBeNull();
    expect(mapProductForCatalog('products/delete', {})).toBeNull();
  });
});

describe('parseProductPaiseToRupees', () => {
  it.each([
    [155900, 1559],
    ['155900', 1559],
    [49900, 499],
    [1, 0.01],
    [0, 0],
  ])('%s paise → ₹%s', (raw, rupees) => {
    expect(parseProductPaiseToRupees(raw)).toBe(rupees);
  });

  it('returns null for absent/garbage values', () => {
    expect(parseProductPaiseToRupees(undefined)).toBeNull();
    expect(parseProductPaiseToRupees('abc')).toBeNull();
    expect(parseProductPaiseToRupees(null)).toBeNull();
  });
});

describe('buildCatalogIdempotencyKey', () => {
  it('is <topic>:<product id>', () => {
    expect(buildCatalogIdempotencyKey('products/create', PRODUCT_ID)).toBe(
      `products/create:${PRODUCT_ID}`,
    );
  });
});
