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
});
