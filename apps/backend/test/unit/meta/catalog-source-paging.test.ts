import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogSourceService } from '../../../src/modules/meta/catalog/catalog-source.service';

/**
 * os-item ignores our requested `limit` and caps page size at ~10. The pager
 * must therefore page on the API's own `hasNext`/`totalPages` signal — NOT on
 * "returned fewer than the requested limit" (which is ALWAYS true here and made
 * the feed stop after page 1, e.g. 335 products → only the 10 on page 1).
 */
function jsonPage(products: number, extra: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ data: Array.from({ length: products }, (_, i) => ({ id: `p${i}` })), ...extra }),
    { status: 200 },
  );
}

describe('CatalogSourceService.eachPage pagination', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps paging via hasNext even when each page is far smaller than the requested limit', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonPage(10, { hasNext: true, totalPages: 3, page: 1 }))
      .mockResolvedValueOnce(jsonPage(10, { hasNext: true, totalPages: 3, page: 2 }))
      .mockResolvedValueOnce(jsonPage(5, { hasNext: false, totalPages: 3, page: 3 }));
    vi.stubGlobal('fetch', fetchMock);

    const svc = new CatalogSourceService();
    const pages: number[] = [];
    const total = await svc.eachPage('m1', async (batch) => {
      pages.push(batch.length);
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(pages).toEqual([10, 10, 5]);
    expect(total).toBe(25);
  });

  it('stops on an empty page when no pagination metadata is present', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonPage(10, {}))
      .mockResolvedValueOnce(jsonPage(0, {}));
    vi.stubGlobal('fetch', fetchMock);

    const svc = new CatalogSourceService();
    let count = 0;
    const total = await svc.eachPage('m1', async (b) => {
      count += b.length;
    });

    expect(total).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
