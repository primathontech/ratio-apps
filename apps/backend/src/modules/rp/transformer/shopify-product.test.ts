import { describe, it, expect } from 'vitest';
import { RpTransformerService } from './transformer.service';

// Confirmed in docs/agent/context/learnings.md (2026-06-18): the platform returns product
// images in TWO different shapes depending on the source — REST `GET /products` gives
// `images[].src` (Shopify-compatible already), but the raw webhook `product` payload gives
// `images[].url` instead. shopifyProduct() is called on raw product data from BOTH sources
// (RpProductsService.getProduct for REST, RpWebhooksService.forward for webhook-sourced
// product-create/update), so it must normalize both shapes to Shopify's expected `.src` —
// otherwise a product synced via webhook silently has no `image.src`/`images[].src` and RP
// falls back to its placeholder image.
const t = new RpTransformerService();

describe('RpTransformerService.shopifyProduct - image field mapping', () => {
  it('passes through images already shaped with .src (REST API shape)', () => {
    const ratioProduct = {
      id: 'prod_1',
      images: [{ id: 'img_1', src: 'https://cdn.example.com/rest-shape.jpg' }],
      variants: [{ id: 'var_1', title: 'Default' }],
    };

    const result = t.shopifyProduct(ratioProduct);

    expect((result.image as Record<string, unknown>)?.src).toBe('https://cdn.example.com/rest-shape.jpg');
    expect((result.images as Array<Record<string, unknown>>)[0]?.src).toBe('https://cdn.example.com/rest-shape.jpg');
  });

  it('derives .src from .url for images shaped like the raw webhook payload', () => {
    const ratioProduct = {
      id: 'prod_2',
      images: [{ id: 'img_2', url: 'https://cdn.example.com/webhook-shape.jpg' }],
      variants: [{ id: 'var_2', title: 'Default' }],
    };

    const result = t.shopifyProduct(ratioProduct);

    expect((result.image as Record<string, unknown>)?.src).toBe('https://cdn.example.com/webhook-shape.jpg');
    expect((result.images as Array<Record<string, unknown>>)[0]?.src).toBe('https://cdn.example.com/webhook-shape.jpg');
  });

  it('leaves image null when the product has no images at all', () => {
    const ratioProduct = { id: 'prod_3', images: [], variants: [] };

    const result = t.shopifyProduct(ratioProduct);

    expect(result.image).toBeNull();
    expect(result.images).toEqual([]);
  });
});

// Confirmed live (2026-08-04, sandbox-momsco): RP's exchange picker
// (groupVariantsOptionsWithname in return_prime_public_react/src/Components/Utils/Utils.jsx)
// assumes ONE options[] entry per distinct populated optionN key across a product's variants,
// indexed in order (options[0] for option1, options[1] for option2, ...). Reproduced crash:
// "TypeError: Cannot read properties of undefined (reading 'name')" when a product's variants
// populate option1 AND option2 with real values but shopifyProduct() always synthesized
// exactly one "Title" options entry — options[1] was undefined.
describe('RpTransformerService.shopifyProduct - options array dimensionality', () => {
  it('synthesizes exactly one "Title" option when only option1 is populated (the common case)', () => {
    const ratioProduct = {
      id: 'prod_4',
      images: [],
      variants: [
        { id: 'var_1', title: '50gm', option1: '50gm' },
        { id: 'var_2', title: '100gm', option1: '100gm' },
      ],
    };

    const result = t.shopifyProduct(ratioProduct);
    const options = result.options as Array<Record<string, unknown>>;

    expect(options).toHaveLength(1);
    expect(options[0]?.name).toBe('Title');
    expect(options[0]?.values).toEqual(['50gm', '100gm']);
  });

  it('synthesizes TWO option entries when both option1 and option2 are populated on the variants', () => {
    const ratioProduct = {
      id: 'prod_5',
      images: [],
      variants: [
        { id: 'var_1', title: '50gm / 100gm', option1: '50gm', option2: '100gm' },
        { id: 'var_2', title: '100gm / 100gm', option1: '100gm', option2: '100gm' },
      ],
    };

    const result = t.shopifyProduct(ratioProduct);
    const options = result.options as Array<Record<string, unknown>>;

    expect(options).toHaveLength(2);
    expect(options[0]?.name).toBe('Title');
    expect(options[0]?.values).toEqual(['50gm', '100gm']);
    expect(options[1]?.name).toBe('Option 2');
    expect(options[1]?.values).toEqual(['100gm']);
  });

  it('synthesizes THREE option entries when option1, option2, and option3 are all populated', () => {
    const ratioProduct = {
      id: 'prod_6',
      images: [],
      variants: [
        { id: 'var_1', title: 'A / B / C', option1: 'A', option2: 'B', option3: 'C' },
      ],
    };

    const result = t.shopifyProduct(ratioProduct);
    const options = result.options as Array<Record<string, unknown>>;

    expect(options).toHaveLength(3);
    expect(options.map((o) => o.name)).toEqual(['Title', 'Option 2', 'Option 3']);
  });

  it('falls back to the single "Default Title" option when there are no variants', () => {
    const ratioProduct = { id: 'prod_7', images: [], variants: [] };

    const result = t.shopifyProduct(ratioProduct);
    const options = result.options as Array<Record<string, unknown>>;

    expect(options).toHaveLength(1);
    expect(options[0]?.name).toBe('Title');
    expect(options[0]?.values).toEqual(['Default Title']);
  });
});
