import { describe, expect, it, vi } from 'vitest';
import { RatioProductsService } from '../../../../src/modules/wizzy/catalog/ratio-products.service';

/**
 * The by-id endpoint wraps the product in an envelope. The live shape (verified
 * against a real log) is `{ product: {...} }`; some environments use
 * `{ data: {...} }`, and it may also return the product object directly.
 * `getById` must unwrap all three, else `parseRestProduct` sees no id/title and
 * throws "could not parse product".
 */
function makeService(raw: unknown) {
  const tokens = { getAccessToken: vi.fn(async () => 'tok') };
  const ratio = { request: vi.fn(async () => raw) };
  return new RatioProductsService(tokens as never, ratio as never);
}

const productBody = () => ({
  id: '9140440137980',
  title: 'Wellcore Creatine',
  handle: 'wellcore-creatine',
  price: 58800,
  sku: 'WCCE122G_P1_WW',
  product_availability: true,
  variants: [{ id: 'v1', price: 58800, availableForSale: true, inventory_quantity: 0 }],
  images: [{ src: 'https://x/i.png' }],
});

describe('RatioProductsService.getById — envelope unwrapping', () => {
  it('unwraps a { product: {...} } envelope (the live by-id shape)', async () => {
    const svc = makeService({ product: productBody() });
    const p = await svc.getById('m1', '9140440137980');
    expect(p.id).toBe('9140440137980');
    expect(p.variants[0]?.availableForSale).toBe(true);
  });

  it('unwraps a { data: {...} } envelope', async () => {
    const svc = makeService({ data: productBody() });
    const p = await svc.getById('m1', '9140440137980');
    expect(p.id).toBe('9140440137980');
  });

  it('accepts the product object directly (no envelope)', async () => {
    const svc = makeService(productBody());
    const p = await svc.getById('m1', '9140440137980');
    expect(p.id).toBe('9140440137980');
  });
});
