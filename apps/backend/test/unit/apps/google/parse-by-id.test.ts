import { describe, expect, it } from 'vitest';
import { isSellable } from '../../../../src/modules/google/gmc/google-product-sync.queue';
import { parseRestProduct } from '../../../../src/modules/google/gmc/parse-ratio-product';

// Trimmed real `GET /products/:id` response under the `{ product }` envelope
// (auth token / PII stripped). Used to prove the by-id shape maps + gates.
const byId = {
  id: '7942069485646',
  title: 'Intense Moisture Hair Mask',
  body_html: '<p>desc</p>',
  vendor: 'BBlunt',
  product_type: 'Kits',
  handle: 'intense-moisture-hair-mask',
  status: 'active',
  published_at: '2026-06-12T16:47:51+05:30',
  is_deleted: false,
  options: [],
  variants: [
    {
      id: '43860696924238',
      title: 'Default Title',
      price: 41900,
      compare_at_price: 83700,
      option1: 'Default Title',
      sku: '',
      barcode: null,
      inventory_quantity: 0,
    },
  ],
  images: [{ src: 'https://os-resources.example/178129823947786.png' }],
} as Record<string, unknown>;

describe('by-id product → mapper + gate', () => {
  it('parseRestProduct maps the by-id shape (price paise → rupees, image src)', () => {
    const p = parseRestProduct(byId);
    expect(p?.id).toBe('7942069485646');
    expect(p?.variants[0]?.price).toBe(419); // 41900 paise ÷ 100
    expect(p?.images[0]?.src).toContain('178129823947786.png');
  });

  it('an active + published product is sellable', () => {
    expect(isSellable(byId)).toBe(true);
  });

  it('draft / unpublished / deleted are NOT sellable', () => {
    expect(isSellable({ ...byId, status: 'draft' })).toBe(false);
    expect(isSellable({ ...byId, published_at: null })).toBe(false);
    expect(isSellable({ ...byId, is_deleted: true })).toBe(false);
  });
});
