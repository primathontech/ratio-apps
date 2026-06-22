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

/** A product Meta rejected, with the reason — surfaced to the sync log / admin. */
export interface CatalogFailure {
  retailerId: string;
  error: string;
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
      // items_batch wants price as a single "<amount> <currency>" string
      // (e.g. "1039.00 INR"); a separate `currency` field is rejected as an
      // unrecognised field. Our price is integer paise → divide by 100.
      price: `${(p.price / 100).toFixed(2)} ${p.currency}`,
      link: p.url,
      image_link: p.imageUrl,
      brand: p.brand,
    };
    if (p.additionalImageUrls.length) data.additional_image_link = p.additionalImageUrls.join(',');
    if (p.salePrice !== undefined) data.sale_price = `${(p.salePrice / 100).toFixed(2)} ${p.currency}`;
    if (p.itemGroupId) data.item_group_id = p.itemGroupId;
    if (p.productType) data.product_type = p.productType;
    if (p.category) data.google_product_category = p.category;
    return data;
  }

  /**
   * Push requests to Meta in ≤1,000 chunks. Returns counts plus the items that
   * FAILED — each with the Meta error message — so the caller can mark only the
   * accepted ones as synced AND record why the rest failed (sync log / admin).
   */
  async send(
    catalogId: string,
    accessToken: string,
    requests: CatalogBatchRequest[],
  ): Promise<{ sent: number; failed: number; failures: CatalogFailure[] }> {
    let sent = 0;
    let failed = 0;
    const failures: CatalogFailure[] = [];
    for (let i = 0; i < requests.length; i += CatalogBatchService.MAX_BATCH) {
      const chunk = requests.slice(i, i + CatalogBatchService.MAX_BATCH);
      const r = await this.sendChunk(catalogId, accessToken, chunk);
      sent += r.sent;
      failed += r.failed;
      failures.push(...r.failures);
    }
    return { sent, failed, failures };
  }

  /** One chunk (≤1000) with transient retry + content-error bisection. */
  private async sendChunk(
    catalogId: string,
    accessToken: string,
    requests: CatalogBatchRequest[],
    depth = 0,
  ): Promise<{ sent: number; failed: number; failures: CatalogFailure[] }> {
    if (!requests.length) return { sent: 0, failed: 0, failures: [] };
    let lastError = 'failed after retries';
    const url = `${graphBase()}/${catalogId}/items_batch`;
    // Real Meta requires form-urlencoded with `requests` as a JSON STRING, and
    // the retailer id inside `data.id` (NOT a top-level retailer_id). Our mock
    // was lenient about both. retailer_id is kept on CatalogBatchRequest only
    // for internal failed-id tracking; here we fold it into data.id.
    const payload = requests.map((r) => ({ method: r.method, data: { id: r.retailer_id, ...(r.data ?? {}) } }));
    const body = new URLSearchParams({
      access_token: accessToken,
      item_type: 'PRODUCT_ITEM',
      requests: JSON.stringify(payload),
    }).toString();

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
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          signal: controller.signal,
        });
        if (res.ok) {
          // A 200 can still carry per-item rejections in `validation_status`
          // (e.g. a bad field on one item). Treat those as failed (by their
          // retailer_id) so they're recorded as `error` and retried, not
          // counted as synced. Warnings (not errors) are fine.
          const json = (await res.json().catch(() => ({}))) as {
            validation_status?: { retailer_id?: string; errors?: { message?: string }[] }[];
          };
          const failures: CatalogFailure[] = (json.validation_status ?? [])
            .filter((v) => Array.isArray(v.errors) && v.errors.length > 0)
            .map((v) => ({ retailerId: v.retailer_id ?? '', error: v.errors?.[0]?.message ?? 'validation error' }))
            .filter((f) => f.retailerId);
          if (failures.length) {
            this.logger.warn({ msg: 'catalog items failed validation', count: failures.length, sample: failures[0]?.error });
          }
          return { sent: requests.length - failures.length, failed: failures.length, failures };
        }

        const text = await res.text().catch(() => '');
        // Content rejection (one bad item kills the batch) → bisect to isolate.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          if (requests.length === 1) {
            const id = requests[0]?.retailer_id ?? '';
            const error = text.slice(0, 300);
            this.logger.warn({ msg: 'catalog item rejected — quarantined', retailer_id: id, err: error });
            return { sent: 0, failed: 1, failures: [{ retailerId: id, error }] };
          }
          if (depth > 12) {
            // safety cap — give up on the whole sub-batch
            return { sent: 0, failed: requests.length, failures: requests.map((r) => ({ retailerId: r.retailer_id, error: text.slice(0, 300) })) };
          }
          const mid = Math.ceil(requests.length / 2);
          const a = await this.sendChunk(catalogId, accessToken, requests.slice(0, mid), depth + 1);
          const b = await this.sendChunk(catalogId, accessToken, requests.slice(mid), depth + 1);
          return { sent: a.sent + b.sent, failed: a.failed + b.failed, failures: [...a.failures, ...b.failures] };
        }
        // 429 / 5xx → retry whole chunk
        lastError = `Meta ${res.status}: ${text.slice(0, 200)}`;
        this.logger.warn({ msg: 'catalog batch retryable error', status: res.status, attempt });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        this.logger.warn({ msg: 'catalog batch network error', attempt, err });
      } finally {
        clearTimeout(timeout);
      }
    }
    return { sent: 0, failed: requests.length, failures: requests.map((r) => ({ retailerId: r.retailer_id, error: lastError })) };
  }

  private backoff(attempt: number): Promise<void> {
    const base = 500 * 2 ** (attempt - 2);
    return new Promise((r) => setTimeout(r, base + Math.random() * base * 0.3));
  }
}
