import { Injectable, Logger } from '@nestjs/common';
import type { MetaProductDto } from './catalog.types';

/** Graph base, read at call time so a `.env` override (mock) is honored. */
function graphBase(): string {
  return process.env.FACEBOOK_CAPI_BASE_URL ?? 'https://graph.facebook.com/v21.0';
}

export type CatalogMethod = 'CREATE' | 'UPDATE' | 'DELETE';

export interface CatalogBatchRequest {
  method: CatalogMethod;
  retailer_id: string;
  data?: Record<string, unknown>;
}

/**
 * Meta Catalog Batch API client (Phase 2 push path).
 *
 *   POST {graph}/{catalog_id}/items_batch
 *   { access_token, item_type:'PRODUCT_ITEM', requests:[{method, retailer_id, data}] }
 *
 * Meta accepts up to 1,000 requests/call and **rejects the whole batch if one
 * item is invalid** — so on a content (4xx) rejection we BISECT: split the batch
 * and retry halves until the single offender is isolated, log+drop it, and let
 * the rest through. Throttle (429) / transient (5xx) retry the whole chunk.
 */
@Injectable()
export class CatalogBatchService {
  private readonly logger = new Logger(CatalogBatchService.name);
  private static readonly MAX_BATCH = 1000;

  /** Map a transformed product → a CREATE/UPDATE request `data` block. */
  toData(p: MetaProductDto): Record<string, unknown> {
    const data: Record<string, unknown> = {
      title: p.name,
      description: p.description,
      availability: p.availability,
      condition: p.condition,
      // Meta items_batch takes price in minor units + a currency field.
      price: p.price,
      currency: p.currency,
      link: p.url,
      image_link: p.imageUrl,
      brand: p.brand,
    };
    if (p.additionalImageUrls.length) data.additional_image_link = p.additionalImageUrls.join(',');
    if (p.salePrice !== undefined) data.sale_price = p.salePrice;
    if (p.itemGroupId) data.item_group_id = p.itemGroupId;
    if (p.productType) data.product_type = p.productType;
    if (p.category) data.google_product_category = p.category;
    return data;
  }

  /** Push requests to Meta in ≤1,000 chunks. Returns counts. */
  async send(
    catalogId: string,
    accessToken: string,
    requests: CatalogBatchRequest[],
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < requests.length; i += CatalogBatchService.MAX_BATCH) {
      const chunk = requests.slice(i, i + CatalogBatchService.MAX_BATCH);
      const r = await this.sendChunk(catalogId, accessToken, chunk);
      sent += r.sent;
      failed += r.failed;
    }
    return { sent, failed };
  }

  /** One chunk (≤1000) with transient retry + content-error bisection. */
  private async sendChunk(
    catalogId: string,
    accessToken: string,
    requests: CatalogBatchRequest[],
    depth = 0,
  ): Promise<{ sent: number; failed: number }> {
    if (!requests.length) return { sent: 0, failed: 0 };
    const url = `${graphBase()}/${catalogId}/items_batch`;
    const body = JSON.stringify({
      access_token: accessToken,
      item_type: 'PRODUCT_ITEM',
      requests,
    });

    if (process.env.META_TEST_EVENT_CODE) {
      this.logger.log({
        msg: 'Catalog items_batch (test mode)',
        url,
        count: requests.length,
        sample: requests.slice(0, 2).map((r) => ({ method: r.method, retailer_id: r.retailer_id })),
      });
    }

    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) await this.backoff(attempt);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });
        if (res.ok) return { sent: requests.length, failed: 0 };

        const text = await res.text().catch(() => '');
        // Content rejection (one bad item kills the batch) → bisect to isolate.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          if (requests.length === 1) {
            this.logger.warn({ msg: 'catalog item rejected — quarantined', retailer_id: requests[0]?.retailer_id, err: text.slice(0, 300) });
            return { sent: 0, failed: 1 };
          }
          if (depth > 12) return { sent: 0, failed: requests.length }; // safety cap
          const mid = Math.ceil(requests.length / 2);
          const a = await this.sendChunk(catalogId, accessToken, requests.slice(0, mid), depth + 1);
          const b = await this.sendChunk(catalogId, accessToken, requests.slice(mid), depth + 1);
          return { sent: a.sent + b.sent, failed: a.failed + b.failed };
        }
        // 429 / 5xx → retry whole chunk
        this.logger.warn({ msg: 'catalog batch retryable error', status: res.status, attempt });
      } catch (err) {
        this.logger.warn({ msg: 'catalog batch network error', attempt, err });
      } finally {
        clearTimeout(timeout);
      }
    }
    return { sent: 0, failed: requests.length };
  }

  private backoff(attempt: number): Promise<void> {
    const base = 500 * 2 ** (attempt - 2);
    return new Promise((r) => setTimeout(r, base + Math.random() * base * 0.3));
  }
}
