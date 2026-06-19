import { describe, expect, it } from 'vitest';
import { parseRestProduct } from '../../../../src/modules/google/gmc/parse-ratio-product';

const sample = (): Record<string, unknown> => ({
  id: 'product-uuid',
  name: 'Classic Cotton T-Shirt',
  description: 'A classic tee',
  status: 'active',
  vendor: 'Brand Name',
  productType: 'Apparel',
  tags: ['cotton'],
  variants: [
    {
      id: 'variant-uuid-1',
      name: 'Small / Blue',
      sku: 'TSHIRT-S-BLU',
      price: 29.99,
      compareAtPrice: 39.99,
      inventory: { quantity: 50, policy: 'deny' },
      options: { size: 'Small', color: 'Blue' },
    },
  ],
  images: [
    {
      id: 'image-uuid',
      src: 'https://cdn.example.com/products/tshirt-blue.jpg',
      alt: '...',
      position: 1,
    },
  ],
  options: [{ name: 'Size', values: ['Small'] }],
});

describe('parseRestProduct', () => {
  it('maps product-level fields with title from name', () => {
    const p = parseRestProduct(sample());
    expect(p).not.toBeNull();
    expect(p!.id).toBe('product-uuid');
    expect(p!.title).toBe('Classic Cotton T-Shirt');
    expect(p!.description).toBe('A classic tee');
    expect(p!.vendor).toBe('Brand Name');
    expect(p!.productType).toBe('Apparel');
  });

  it('slugs name for handle when handle absent', () => {
    const p = parseRestProduct(sample());
    expect(p!.handle).toBe('classic-cotton-t-shirt');
  });

  it('prefers explicit handle when present', () => {
    const data = sample();
    data.handle = 'custom-handle';
    const p = parseRestProduct(data);
    expect(p!.handle).toBe('custom-handle');
  });

  it('maps variants without dividing prices', () => {
    const p = parseRestProduct(sample());
    const v = p!.variants[0];
    expect(v.id).toBe('variant-uuid-1');
    expect(v.sku).toBe('TSHIRT-S-BLU');
    expect(v.price).toBe(29.99);
    expect(v.compareAtPrice).toBe(39.99);
    expect(v.inventoryQuantity).toBe(50);
    expect(v.options).toEqual({ size: 'Small', color: 'Blue' });
  });

  it('maps images from images[].src', () => {
    const p = parseRestProduct(sample());
    expect(p!.images).toEqual([
      { src: 'https://cdn.example.com/products/tshirt-blue.jpg' },
    ]);
  });

  it('returns null without id or name', () => {
    const data = sample();
    delete data.id;
    expect(parseRestProduct(data)).toBeNull();
    const data2 = sample();
    delete data2.name;
    expect(parseRestProduct(data2)).toBeNull();
  });

  it('synthesizes a single variant from product-level fields when variants empty', () => {
    const data = sample();
    data.variants = [];
    data.price = 19.99;
    data.compareAtPrice = 24.99;
    data.sku = 'TSHIRT-DEF';
    const p = parseRestProduct(data);
    expect(p!.variants).toHaveLength(1);
    const v = p!.variants[0];
    expect(v.id).toBe('product-uuid');
    expect(v.price).toBe(19.99);
    expect(v.compareAtPrice).toBe(24.99);
    expect(v.sku).toBe('TSHIRT-DEF');
  });
});
