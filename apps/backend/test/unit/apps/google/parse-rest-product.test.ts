import { describe, expect, it } from 'vitest';
import { parseRestProduct } from '../../../../src/modules/google/gmc/parse-ratio-product';

/**
 * The REST `/products` list returns the platform's Shopify-shaped product JSON
 * (verified live on QA, identical across environments): snake_case product keys
 * (`title`, `body_html`, `product_type`), variants with `id`/`sku`/`price`/
 * `compare_at_price`/`inventory_quantity` + positional `option1/2/3`, and
 * `images[].src`. Prices are integer PAISE.
 */
const sample = (): Record<string, unknown> => ({
  id: '9317985059068',
  title: 'Classic Cotton T-Shirt',
  body_html: '<p>A classic tee</p>',
  status: 'active',
  vendor: 'Brand Name',
  product_type: 'Apparel',
  tags: 'cotton',
  variants: [
    {
      id: 'variant-1',
      title: 'Small / Blue',
      sku: 'TSHIRT-S-BLU',
      price: 2999, // paise → 29.99
      compare_at_price: 3999, // paise → 39.99
      barcode: '8901234567890',
      inventory_quantity: 50,
      option1: 'Small',
      option2: 'Blue',
      option3: null,
      imageUrl: 'https://cdn.example.com/variant-blue.jpg',
    },
  ],
  options: [
    { name: 'Size', position: 1, values: ['Small'] },
    { name: 'Color', position: 2, values: ['Blue'] },
  ],
  images: [{ id: 'img-1', src: 'https://cdn.example.com/products/tshirt-blue.jpg', position: 1 }],
});

describe('parseRestProduct', () => {
  it('maps product-level fields (title, body_html, product_type)', () => {
    const p = parseRestProduct(sample());
    expect(p).not.toBeNull();
    expect(p!.id).toBe('9317985059068');
    expect(p!.title).toBe('Classic Cotton T-Shirt');
    expect(p!.description).toBe('<p>A classic tee</p>');
    expect(p!.vendor).toBe('Brand Name');
    expect(p!.productType).toBe('Apparel');
  });

  it('slugs title for handle when handle absent', () => {
    const p = parseRestProduct(sample());
    expect(p!.handle).toBe('classic-cotton-t-shirt');
  });

  it('prefers explicit handle when present', () => {
    const data = sample();
    data.handle = 'custom-handle';
    const p = parseRestProduct(data);
    expect(p!.handle).toBe('custom-handle');
  });

  it('divides paise prices to rupees and maps option1/2/3 to option names', () => {
    const p = parseRestProduct(sample());
    const v = p!.variants[0];
    expect(v.id).toBe('variant-1');
    expect(v.sku).toBe('TSHIRT-S-BLU');
    expect(v.barcode).toBe('8901234567890');
    expect(v.price).toBe(29.99);
    expect(v.compareAtPrice).toBe(39.99);
    expect(v.inventoryQuantity).toBe(50);
    expect(v.options).toEqual({ Size: 'Small', Color: 'Blue' });
  });

  it('maps images from images[].src', () => {
    const p = parseRestProduct(sample());
    expect(p!.images).toEqual([{ src: 'https://cdn.example.com/products/tshirt-blue.jpg' }]);
  });

  it('falls back to the variant imageUrl when images[] is empty', () => {
    const data = sample();
    data.images = [];
    const p = parseRestProduct(data);
    expect(p!.images).toEqual([{ src: 'https://cdn.example.com/variant-blue.jpg' }]);
  });

  it("skips Shopify's synthetic single-variant placeholder (option 'Title'='Default Title')", () => {
    const data = sample();
    data.options = [{ name: 'Title', position: 1, values: ['Default Title'] }];
    (data.variants as Record<string, unknown>[])[0] = {
      id: 'v-default',
      title: 'Default Title',
      sku: 'SKU-DEF',
      price: 155900, // ₹1,559
      compare_at_price: 209800, // ₹2,098
      barcode: null,
      inventory_quantity: 0,
      option1: 'Default Title',
      option2: null,
      option3: null,
    };
    const p = parseRestProduct(data);
    const v = p!.variants[0];
    expect(v.options).toBeUndefined();
    expect(v.price).toBe(1559);
    expect(v.compareAtPrice).toBe(2098);
    expect(v.inventoryQuantity).toBe(0);
  });

  it('returns null without id or title', () => {
    const data = sample();
    delete data.id;
    expect(parseRestProduct(data)).toBeNull();
    const data2 = sample();
    delete data2.title;
    expect(parseRestProduct(data2)).toBeNull();
  });

  it('synthesizes a single variant from product-level fields when variants empty', () => {
    const data = sample();
    data.variants = [];
    data.price = 1999;
    data.compare_at_price = 2499;
    data.sku = 'TSHIRT-DEF';
    data.inventory_quantity = 7;
    const p = parseRestProduct(data);
    expect(p!.variants).toHaveLength(1);
    const v = p!.variants[0];
    expect(v.id).toBe('9317985059068');
    expect(v.price).toBe(19.99);
    expect(v.compareAtPrice).toBe(24.99);
    expect(v.sku).toBe('TSHIRT-DEF');
    expect(v.inventoryQuantity).toBe(7);
  });
});
