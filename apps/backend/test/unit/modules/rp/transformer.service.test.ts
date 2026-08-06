import { describe, expect, it } from 'vitest';
import { RpTransformerService } from '../../../../src/modules/rp/transformer/transformer.service';

/**
 * RP's checkBlocked (return_prime_public/src/services/v1/common.service.js) treats
 * `inventory_management === null` as "not blocked" — that's the only way Shopify
 * represents an untracked-inventory variant. Any other value (including `undefined`,
 * which is what a variant looks like if the key is simply missing) falls through to
 * "blocked", regardless of stock. Every OS-sourced variant was blocked unconditionally
 * because the transformer never set this field at all.
 */
describe('RpTransformerService.shopifyProduct', () => {
  const service = new RpTransformerService();

  function osProduct(overrides: Record<string, unknown> = {}) {
    return {
      id: '7505731649614',
      title: 'Intense Shine Shampoo',
      handle: 'intense-shine-shampoo',
      vendor: 'BBlunt',
      variants: [
        {
          id: '42020556374094',
          title: 'Default Title',
          sku: '8904417308105',
          price: 8800,
          inventory_quantity: 1,
        },
      ],
      images: [],
      ...overrides,
    };
  }

  it('sets inventory_management to null on every variant, matching Shopify\'s untracked-inventory shape', () => {
    const result = service.shopifyProduct(osProduct());
    const variants = result.variants as Array<Record<string, unknown>>;

    expect(variants).toHaveLength(1);
    expect(variants[0].inventory_management).toBeNull();
  });

  // RP's exchange-reserve flow (reserveExchangeInventoryOnShopify in
  // return_prime_public) reads inventory_item_id straight off its cached product
  // object, then round-trips it back to /rp/shopify/inventory_levels/adjust —
  // that endpoint only works if this id matches variant.id (both hashed the same
  // way), since OS has no separate inventory-item entity to give a distinct id.
  it('sets inventory_item_id to the same (hashed) value as the variant id', () => {
    const result = service.shopifyProduct(osProduct());
    const variants = result.variants as Array<Record<string, unknown>>;

    expect(variants[0].inventory_item_id).toBe(variants[0].id);
    expect(variants[0].inventory_item_id).not.toBeUndefined();
  });
});

// Ratio's order-create endpoint 400s without these — confirmed empirically against
// the live sandbox API: {"message":["test should not be empty","test must be a
// boolean value","line_items.0.taxable must be a boolean value",
// "line_items.0.requires_shipping must be a boolean value"]}. RP's exchange-order
// line items never carry taxable/requires_shipping (not modeled in RP's Order
// schema) and RP never sends a `test` flag at all — every OS exchange-order
// creation failed with this 400 until these were defaulted here.
describe('RpTransformerService.mapCreateOrder', () => {
  const service = new RpTransformerService();

  function shopifyOrder(overrides: Record<string, unknown> = {}) {
    return {
      email: 'test@example.com',
      phone: '9999999999',
      financial_status: 'paid',
      payment_gateway_names: ['ReturnPrime'],
      line_items: [{ variant_id: '1', product_id: '2', title: 'test item', quantity: 1, price: '100' }],
      ...overrides,
    };
  }

  it('always sets test: false, regardless of input', () => {
    const result = service.mapCreateOrder(shopifyOrder());
    expect(result.test).toBe(false);
  });

  it('defaults taxable and requires_shipping to true on every line item when RP does not send them', () => {
    const result = service.mapCreateOrder(shopifyOrder());
    const lineItems = result.line_items as Array<Record<string, unknown>>;

    expect(lineItems[0].taxable).toBe(true);
    expect(lineItems[0].requires_shipping).toBe(true);
  });

  it('forwards an explicit taxable/requires_shipping value instead of overriding it', () => {
    const result = service.mapCreateOrder(
      shopifyOrder({ line_items: [{ variant_id: '1', quantity: 1, price: '100', taxable: false, requires_shipping: false }] }),
    );
    const lineItems = result.line_items as Array<Record<string, unknown>>;

    expect(lineItems[0].taxable).toBe(false);
    expect(lineItems[0].requires_shipping).toBe(false);
  });
});
