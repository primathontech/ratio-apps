import { describe, expect, it, vi } from 'vitest';
import type { RatioClient } from '../../../../src/core/ratio-client/ratio.client';
import { RatioProductsService } from '../../../../src/modules/google/gmc/ratio-products.service';
import type { RatioTokenProvider } from '../../../../src/modules/google/google-oauth/ratio-token.provider';

/** Fake token provider — yields a (refreshed) access token for the merchant. */
function fakeTokens(token: string | (() => Promise<string>)): RatioTokenProvider {
  const getAccessToken = typeof token === 'function' ? vi.fn(token) : vi.fn(async () => token);
  return { getAccessToken } as unknown as RatioTokenProvider;
}

const item = (id: string, name: string): Record<string, unknown> => ({
  id,
  name,
  status: 'active',
  vendor: 'Brand',
  variants: [{ id: `v-${id}`, price: 2999, inventory: { quantity: 50 } }],
  images: [{ src: `https://cdn.example.com/${id}.jpg` }],
});

describe('RatioProductsService.listAll', () => {
  it('pages the envelope and maps each item via parseRestProduct (paise → rupees)', async () => {
    const paths: string[] = [];
    const request = vi.fn().mockImplementation(async (path: string) => {
      paths.push(path);
      if (path.includes('page=1')) {
        return { success: true, data: [item('p1', 'One')], pagination: { page: 1, totalPages: 2 } };
      }
      return { success: true, data: [item('p2', 'Two')], pagination: { page: 2, totalPages: 2 } };
    });
    const ratio = { request } as unknown as RatioClient;

    const svc = new RatioProductsService(fakeTokens('tok'), ratio);

    const products = await svc.listAll('m1');

    expect(products).toHaveLength(2);
    expect(products[0].id).toBe('p1');
    expect(products[1].id).toBe('p2');
    // Paise (2999) divide to rupees (29.99); inventory from inventory.quantity.
    expect(products[0].variants[0].price).toBe(29.99);
    expect(products[0].variants[0].inventoryQuantity).toBe(50);

    expect(request).toHaveBeenCalledTimes(2);
    for (const p of paths) {
      expect(p).toContain('status=active');
      expect(p).toContain('published=true');
      expect(p).toContain('show_variants=true');
    }
  });

  it('propagates the token provider error when the merchant has no token', async () => {
    const request = vi.fn();
    const svc = new RatioProductsService(
      fakeTokens(async () => {
        throw new Error('no Ratio oauth_tokens row for merchant m1');
      }),
      { request } as unknown as RatioClient,
    );
    await expect(svc.listAll('m1')).rejects.toThrow('no Ratio oauth_tokens row');
    expect(request).not.toHaveBeenCalled();
  });
});
