import { describe, expect, it, vi } from 'vitest';
import type { CryptoService } from '../../../../src/core/crypto/crypto.service';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import type { RatioClient } from '../../../../src/core/ratio-client/ratio.client';
import type { GoogleDatabase } from '../../../../src/modules/google/db/types';
import { RatioProductsService } from '../../../../src/modules/google/gmc/ratio-products.service';

/** Fake handle whose oauth_tokens select returns a row with an encrypted token. */
function fakeHandle(row: { accessTokenEnc: string } | undefined): KyselyClient<GoogleDatabase> {
  const chain = {
    select: () => chain,
    where: () => chain,
    executeTakeFirst: async () => row,
  };
  return { db: { selectFrom: () => chain } } as unknown as KyselyClient<GoogleDatabase>;
}

const fakeCrypto = { decrypt: vi.fn().mockReturnValue('tok') } as unknown as CryptoService;

const item = (id: string, name: string): Record<string, unknown> => ({
  id,
  name,
  status: 'active',
  vendor: 'Brand',
  variants: [{ id: `v-${id}`, price: 29.99, inventory: { quantity: 50 } }],
  images: [{ src: `https://cdn.example.com/${id}.jpg` }],
});

describe('RatioProductsService.listAll', () => {
  it('pages the envelope and maps each item via parseRestProduct (rupee prices intact)', async () => {
    const paths: string[] = [];
    const request = vi.fn().mockImplementation(async (path: string) => {
      paths.push(path);
      if (path.includes('page=1')) {
        return { success: true, data: [item('p1', 'One')], pagination: { page: 1, totalPages: 2 } };
      }
      return { success: true, data: [item('p2', 'Two')], pagination: { page: 2, totalPages: 2 } };
    });
    const ratio = { request } as unknown as RatioClient;

    const svc = new RatioProductsService(
      fakeHandle({ accessTokenEnc: 'enc' }),
      fakeCrypto,
      ratio,
    );

    const products = await svc.listAll('m1');

    expect(products).toHaveLength(2);
    expect(products[0].id).toBe('p1');
    expect(products[1].id).toBe('p2');
    // Rupee prices pass through unchanged (no /100); inventory from inventory.quantity.
    expect(products[0].variants[0].price).toBe(29.99);
    expect(products[0].variants[0].inventoryQuantity).toBe(50);

    expect(request).toHaveBeenCalledTimes(2);
    for (const p of paths) {
      expect(p).toContain('status=active');
      expect(p).toContain('published=true');
      expect(p).toContain('show_variants=true');
    }
  });

  it('returns [] when the merchant has no token row', async () => {
    const request = vi.fn();
    const svc = new RatioProductsService(
      fakeHandle(undefined),
      fakeCrypto,
      { request } as unknown as RatioClient,
    );
    expect(await svc.listAll('m1')).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});
