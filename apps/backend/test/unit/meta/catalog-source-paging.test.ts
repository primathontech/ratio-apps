import { describe, expect, it, vi } from 'vitest';
import type { RatioClient } from '../../../src/core/ratio-client/ratio.client';
import { CatalogSourceService } from '../../../src/modules/meta/catalog/catalog-source.service';
import type { MetaRatioTokenProvider } from '../../../src/modules/meta/oauth/ratio-token.provider';

/**
 * Ratio's products endpoint may ignore `all=true` and return only its 10-item
 * page cap. When it reports a larger total, the source must continue with
 * offset paging through the authenticated RatioClient.
 */
function products(offset: number, count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({ id: `p${offset + i}` }));
}

function fakeTokens(): MetaRatioTokenProvider {
  return {
    getAccessToken: vi.fn(async () => 'ratio-access-token'),
  } as unknown as MetaRatioTokenProvider;
}

describe('CatalogSourceService.eachPage pagination', () => {
  it('continues with offsets when all=true returns fewer products than the reported total', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        products: products(0, 10),
        pagination: { total: 25, limit: 10 },
      })
      .mockResolvedValueOnce({
        products: products(10, 10),
        pagination: { total: 25, limit: 10 },
      })
      .mockResolvedValueOnce({
        products: products(20, 5),
        pagination: { total: 25, limit: 10 },
      });

    const svc = new CatalogSourceService(fakeTokens(), { request } as unknown as RatioClient);
    const pages: number[] = [];
    const total = await svc.eachPage('m1', async (batch) => {
      pages.push(batch.length);
    });

    expect(request).toHaveBeenCalledTimes(3);
    expect(String(request.mock.calls[0]?.[0])).toContain('all=true');
    expect(String(request.mock.calls[1]?.[0])).toContain('offset=10');
    expect(String(request.mock.calls[2]?.[0])).toContain('offset=20');
    expect(request.mock.calls[0]?.[2]).toMatchObject({ accessToken: 'ratio-access-token' });
    expect(pages).toEqual([10, 10, 5]);
    expect(total).toBe(25);
  });

  it('uses the all=true response as complete when no total metadata is present', async () => {
    const request = vi.fn().mockResolvedValue({ products: products(0, 10) });

    const svc = new CatalogSourceService(fakeTokens(), { request } as unknown as RatioClient);
    let count = 0;
    const total = await svc.eachPage('m1', async (b) => {
      count += b.length;
    });

    expect(total).toBe(10);
    expect(count).toBe(10);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
