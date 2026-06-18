import { describe, expect, it } from 'vitest';
import { parseWebhookProduct } from '../../../../src/modules/google/gmc/parse-ratio-product';

const sample = (): Record<string, unknown> => ({
  id: '7890123456',
  title: 'Premium Wireless Headphones',
  handle: 'premium-wireless-headphones',
  body_html: '<p>...</p>',
  status: 'active',
  vendor: 'AudioTech Inc',
  product_type: 'Electronics',
  tags: 'audio,headphones,wireless',
  price: 199.99,
  compare_at_price: 299.99,
  sku: 'AUD-HDP-PRE-001',
  barcode: '8901234567890',
  imageUrl: 'https://cdn.example.com/products/headphones-main.jpg',
  images: [
    {
      id: 'img-001',
      url: 'https://cdn.example.com/products/headphones-main.jpg',
      altText: 'Front view',
      position: 1,
      isMain: true,
    },
  ],
  options: [{ name: 'Color', position: 1, values: ['Black', 'Silver', 'Blue'] }],
  variants: [
    {
      title: 'Black',
      variant_id: 'var-001',
      product_id: '7890123456',
      sku_id: 'VAR-HDP-BLK-001',
      external_id: 'EXT-VAR-BLK-001',
      barcode: '8901234567891',
      price: 199.99,
      compare_at_price: 299.99,
      cost: 80.0,
      option1: 'Black',
      option2: null,
      option3: null,
      warehouseQt: [{ warehouse_id: 'wh-main', quantity: 75 }],
      low_stock_threshold: 20,
    },
  ],
});

describe('parseWebhookProduct', () => {
  it('maps the product-level fields', () => {
    const p = parseWebhookProduct(sample());
    expect(p).not.toBeNull();
    expect(p!.id).toBe('7890123456');
    expect(p!.title).toBe('Premium Wireless Headphones');
    expect(p!.description).toBe('<p>...</p>');
    expect(p!.handle).toBe('premium-wireless-headphones');
    expect(p!.vendor).toBe('AudioTech Inc');
    expect(p!.productType).toBe('Electronics');
  });

  it('maps variants without dividing prices', () => {
    const p = parseWebhookProduct(sample());
    const v = p!.variants[0];
    expect(v.id).toBe('var-001');
    expect(v.sku).toBe('VAR-HDP-BLK-001');
    expect(v.barcode).toBe('8901234567891');
    expect(v.price).toBe(199.99);
    expect(v.compareAtPrice).toBe(299.99);
  });

  it('sums warehouseQt quantities for inventory', () => {
    const p = parseWebhookProduct(sample());
    expect(p!.variants[0].inventoryQuantity).toBe(75);
  });

  it('maps option1/2/3 to product-level option names', () => {
    const p = parseWebhookProduct(sample());
    expect(p!.variants[0].options).toEqual({ Color: 'Black' });
  });

  it('maps images from images[].url', () => {
    const p = parseWebhookProduct(sample());
    expect(p!.images).toEqual([
      { src: 'https://cdn.example.com/products/headphones-main.jpg' },
    ]);
  });

  it('sums multiple warehouse quantities', () => {
    const data = sample();
    (data.variants as Record<string, unknown>[])[0].warehouseQt = [
      { warehouse_id: 'wh-main', quantity: 75 },
      { warehouse_id: 'wh-2', quantity: 25 },
    ];
    const p = parseWebhookProduct(data);
    expect(p!.variants[0].inventoryQuantity).toBe(100);
  });

  it('falls back to imageUrl when images empty', () => {
    const data = sample();
    data.images = [];
    const p = parseWebhookProduct(data);
    expect(p!.images).toEqual([
      { src: 'https://cdn.example.com/products/headphones-main.jpg' },
    ]);
  });

  it('returns null without id or title', () => {
    const data = sample();
    delete data.id;
    expect(parseWebhookProduct(data)).toBeNull();
    const data2 = sample();
    delete data2.title;
    expect(parseWebhookProduct(data2)).toBeNull();
  });

  it('synthesizes a single variant from product-level fields when variants empty', () => {
    const data = sample();
    data.variants = [];
    const p = parseWebhookProduct(data);
    expect(p!.variants).toHaveLength(1);
    const v = p!.variants[0];
    expect(v.id).toBe('7890123456');
    expect(v.price).toBe(199.99);
    expect(v.compareAtPrice).toBe(299.99);
    expect(v.sku).toBe('AUD-HDP-PRE-001');
    expect(v.barcode).toBe('8901234567890');
  });
});
