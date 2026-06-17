import { Injectable, Logger } from '@nestjs/common';
import type { OsItemProduct } from './catalog.types';

/** os-item admin API base (the merchant's product source of truth). */
function itemApiBase(): string {
  return process.env.RATIO_META_ITEM_API_URL ?? 'https://sandbox-os-item.dev.gokwik.io';
}

/**
 * Reads products from GoKwik's os-item admin API for the full catalog sync.
 * Auth = `gk-merchant-id` header (same as our other os-item calls); `storeId`
 * query = the merchant id. Tolerant of the response shape (`products` / `data`
 * / array) and paginates while a cursor is returned.
 */
@Injectable()
export class CatalogSourceService {
  private readonly logger = new Logger(CatalogSourceService.name);
  private static readonly PAGE = 250;
  private static readonly MAX_PAGES = 400; // safety cap (~100k products)

  /**
   * Stream products page-by-page (bounded memory): `onPage` is awaited for each
   * page before the next is fetched. Used by full-sync and the feed so we never
   * load a whole catalog into memory.
   */
  async eachPage(merchantId: string, onPage: (products: OsItemProduct[]) => Promise<void>): Promise<number> {
    const base = itemApiBase();
    let cursor: string | undefined;
    let total = 0;

    for (let page = 0; page < CatalogSourceService.MAX_PAGES; page++) {
      const params = new URLSearchParams({
        storeId: merchantId,
        limit: String(CatalogSourceService.PAGE),
      });
      if (cursor) params.set('cursor', cursor);

      const res = await fetch(`${base}/api/v1/admin/products?${params.toString()}`, {
        headers: { 'gk-merchant-id': merchantId, accept: 'application/json' },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`os-item products ${res.status}: ${text.slice(0, 300)}`);
      }
      const body = (await res.json()) as Record<string, unknown>;
      const batch = this.extractProducts(body);
      if (batch.length) {
        total += batch.length;
        await onPage(batch);
      }
      cursor = this.extractCursor(body);
      if (!cursor || batch.length === 0) break;
    }

    this.logger.log({ msg: 'streamed os-item products', merchantId, count: total });
    return total;
  }

  private extractProducts(body: Record<string, unknown>): OsItemProduct[] {
    const candidate =
      (Array.isArray(body.products) && body.products) ||
      (Array.isArray(body.data) && body.data) ||
      (Array.isArray((body.data as Record<string, unknown>)?.products) &&
        (body.data as Record<string, unknown>).products) ||
      [];
    return (candidate as unknown[]).filter((p): p is OsItemProduct => {
      return Boolean(p && typeof p === 'object' && 'id' in (p as object));
    });
  }

  private extractCursor(body: Record<string, unknown>): string | undefined {
    const pageInfo = body.pageInfo as Record<string, unknown> | undefined;
    const next =
      body.next_cursor ?? body.cursor ?? pageInfo?.nextCursor ?? pageInfo?.endCursor;
    const hasNext = pageInfo?.hasNextPage;
    if (hasNext === false) return undefined;
    return typeof next === 'string' && next ? next : undefined;
  }
}
