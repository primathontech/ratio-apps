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
