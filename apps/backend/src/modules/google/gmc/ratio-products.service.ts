import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { RatioClient } from '../../../core/ratio-client/ratio.client';
import { RatioTokenProvider } from '../google-oauth/ratio-token.provider';
import { GOOGLE_RATIO } from '../tokens';
import type { RatioProductsPort } from './feed-sync.service';
import { parseRestProduct } from './parse-ratio-product';
import type { RatioProduct } from './product-mapper';

type Rec = Record<string, unknown>;

// Tolerant envelope: the list endpoint's wrapper varies by environment (sandbox
// returned `{ success, data: [...] , pagination }`; QA wraps the array under a
// different key). Accept ANY object (or a bare array) here and locate the items
// array + page count defensively below, so a shape change can't hard-fail sync.
const envelopeSchema = z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]);

/** Return `v` as an array of records, or null when it isn't an array. */
function asArray(v: unknown): Rec[] | null {
  return Array.isArray(v) ? (v as Rec[]) : null;
}

/** Locate the products array across the known envelope shapes. */
function extractItems(env: unknown): Rec[] {
  if (Array.isArray(env)) return env as Rec[];
  if (!env || typeof env !== 'object') return [];
  const o = env as Rec;
  const data = o.data;
  const nested = data && typeof data === 'object' ? (data as Rec) : null;
  return (
    asArray(data) ??
    asArray(o.products) ??
    asArray(o.items) ??
    asArray(o.results) ??
    (nested
      ? (asArray(nested.products) ??
        asArray(nested.items) ??
        asArray(nested.data) ??
        asArray(nested.results))
      : null) ??
    []
  );
}

/** The pagination/meta object, wherever it sits (top-level or under `data`). */
function paginationOf(env: unknown): Rec | null {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return null;
  const o = env as Rec;
  const nested = o.data && typeof o.data === 'object' ? (o.data as Rec) : null;
  const pag = o.pagination ?? o.meta ?? nested?.pagination;
  return pag && typeof pag === 'object' ? (pag as Rec) : null;
}

/** Best-effort total ITEM count from the pagination object (or top level). */
function extractTotalItems(env: unknown): number | null {
  const pag = paginationOf(env);
  const top = env && typeof env === 'object' && !Array.isArray(env) ? (env as Rec) : null;
  const t = pag?.total ?? pag?.totalItems ?? pag?.totalCount ?? pag?.count ?? top?.total;
  return typeof t === 'number' && t >= 0 ? t : null;
}

/**
 * Concrete {@link RatioProductsPort}: resolves a fresh merchant Ratio access
 * token via {@link RatioTokenProvider} (which refreshes + rotates expired tokens),
 * pages `GET /api/v1/v1/products` filtered to active/published products with
 * variants, and maps each REST item into the mapper's `RatioProduct` via
 * {@link parseRestProduct} (prices are rupees — no division).
 */
@Injectable()
export class RatioProductsService implements RatioProductsPort {
  private readonly logger = new Logger(RatioProductsService.name);
  // The products API caps the page size at 10 and only advances the offset when
  // the requested `limit` matches that cap — requesting more (e.g. 100) returns
  // page 1's rows for EVERY page. So request exactly 10 and page through.
  private readonly pageSize = 10;

  constructor(
    private readonly tokens: RatioTokenProvider,
    @Inject(GOOGLE_RATIO) private readonly ratio: RatioClient,
  ) {}

  // Hard ceiling so a misbehaving pager can never loop forever
  // (1000 pages × pageSize products is far beyond any real catalog).
  private readonly maxPages = 1000;

  // Common query filters for every products request.
  private readonly filters = 'status=active&published=true&show_variants=true';

  async listAll(merchantId: string): Promise<RatioProduct[]> {
    const accessToken = await this.tokens.getAccessToken(merchantId);

    // Keyed by product id so a duplicate across pages can't create dup offers.
    const byId = new Map<string, RatioProduct>();
    const collect = (items: Rec[]): void => {
      for (const item of items) {
        const mapped = parseRestProduct(item);
        if (mapped) byId.set(mapped.id, mapped);
      }
    };

    // 1) `all=true` — the documented "return the whole catalog, ignore
    //    pagination" param. One call, no page-offset quirks. (The `page` param
    //    is echoed but NOT applied by this endpoint, so we never rely on it.)
    const env = await this.request(`all=true&${this.filters}`, accessToken);
    const items = extractItems(env);
    const total = extractTotalItems(env);
    collect(items);

    // 2) Fallback: if `all` was ignored (we got fewer than the reported total),
    //    page by OFFSET — the slice param this endpoint actually honors.
    if (total !== null && byId.size < total) {
      for (let offset = 0; offset < total; offset += this.pageSize) {
        const pageEnv = await this.request(
          `limit=${this.pageSize}&offset=${offset}&${this.filters}`,
          accessToken,
        );
        const pageItems = extractItems(pageEnv);
        if (pageItems.length === 0) break; // ran past the end
        collect(pageItems);
        if (offset / this.pageSize >= this.maxPages) break; // runaway guard
      }
    }

    if (byId.size === 0 && items.length === 0) {
      const shape =
        env && typeof env === 'object' && !Array.isArray(env)
          ? Object.keys(env as Rec).join(',')
          : `(${Array.isArray(env) ? 'array' : typeof env})`;
      this.logger.warn({ msg: 'ratio products: no items extracted from envelope', shape });
    }

    const out = [...byId.values()];
    this.logger.log({ msg: 'ratio products fetched', merchantId, products: out.length, total });
    return out;
  }

  /** GET the products list with the given query string. */
  private request(query: string, accessToken: string): Promise<unknown> {
    // NOTE: the products/catalog microservice is mounted under its own `v1` on
    // top of the platform's global `/api/v1` prefix, so the real path is
    // `/api/v1/v1/products` (double v1) on every environment. Verified against
    // the live API: single-`v1` returns 404 "Cannot GET /api/v1/products".
    return this.ratio.request(`/api/v1/v1/products?${query}`, envelopeSchema, { accessToken });
  }
}
