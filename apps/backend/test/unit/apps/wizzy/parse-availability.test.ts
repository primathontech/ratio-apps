import { describe, expect, it } from 'vitest';
import {
  parseRestProduct,
  parseWebhookProduct,
} from '../../../../src/modules/wizzy/catalog/parse-ratio-product';

/**
 * Regression coverage for product-level availability.
 *
 * Many products (e.g. single-variant OSMO items) come back from the platform
 * with an EMPTY `variants: []` and no variant-level `availableForSale` /
 * `inventory_quantity`. Their purchasability lives in the product-level flags
 * `product_availability`, `continue_selling_out_of_stock`, and
 * `track_inventory`. Before the fix these were ignored, so the synthesised
 * variant had `availableForSale: null` + `inventoryQuantity: null` and the
 * transform marked the product OUT OF STOCK — hiding it from Wizzy search.
 */
describe('parseRestProduct — product-level availability (empty variants)', () => {
  const base = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: '9353708470524',
    title: 'OSMO - Electrolyte Hydration Blend | Lemon & Lime',
    body_html: '<ul><li>hydration</li></ul>',
    status: 'active',
    vendor: 'Osmo',
    product_type: 'Electrolytes',
    handle: 'osmo-electrolyte-hydration-blend',
    price: 49900, // paise → ₹499
    compare_at_price: 59900, // paise → ₹599
    sku: 'OSMO270G_P1_LL',
    variants: [], // platform returned no expanded variants
    images: [{ src: 'https://os-resources.example/1.png' }],
    ...overrides,
  });

  it('marks the synthetic variant available when product_availability is true', () => {
    const product = parseRestProduct(
      base({ product_availability: true, continue_selling_out_of_stock: true }),
    );
    expect(product).not.toBeNull();
    expect(product?.variants).toHaveLength(1);
    expect(product?.variants[0]?.availableForSale).toBe(true);
  });

  it('marks available via continue_selling_out_of_stock even without product_availability', () => {
    const product = parseRestProduct(base({ continue_selling_out_of_stock: true }));
    expect(product?.variants[0]?.availableForSale).toBe(true);
  });

  it('marks available for untracked inventory (track_inventory: false)', () => {
    const product = parseRestProduct(base({ track_inventory: false }));
    expect(product?.variants[0]?.availableForSale).toBe(true);
  });

  it('respects an explicit product_availability: false', () => {
    const product = parseRestProduct(
      base({ product_availability: false, continue_selling_out_of_stock: true }),
    );
    expect(product?.variants[0]?.availableForSale).toBe(false);
  });

  it('leaves availableForSale null when no product-level signal is present', () => {
    const product = parseRestProduct(base());
    expect(product?.variants[0]?.availableForSale).toBeNull();
  });

  it('uses product-level availability as the fallback when a real variant omits availableForSale', () => {
    const product = parseRestProduct(
      base({
        product_availability: true,
        variants: [{ id: 'v1', price: 49900, inventory_quantity: 0 }],
      }),
    );
    expect(product?.variants[0]?.availableForSale).toBe(true);
  });

  it('prefers an explicit variant availableForSale over the product-level flag', () => {
    const product = parseRestProduct(
      base({
        product_availability: true,
        variants: [{ id: 'v1', price: 49900, availableForSale: false }],
      }),
    );
    expect(product?.variants[0]?.availableForSale).toBe(false);
  });
});

describe('parseWebhookProduct — product-level availability (empty variants)', () => {
  it('marks the synthetic variant available from product-level flags', () => {
    const product = parseWebhookProduct({
      id: '9353708470524',
      title: 'OSMO - Electrolyte Hydration Blend | Lemon & Lime',
      price: 49900,
      sku: 'OSMO270G_P1_LL',
      variants: [],
      product_availability: true,
      images: [{ url: 'https://os-resources.example/1.png' }],
    });
    expect(product?.variants).toHaveLength(1);
    expect(product?.variants[0]?.availableForSale).toBe(true);
  });
});
