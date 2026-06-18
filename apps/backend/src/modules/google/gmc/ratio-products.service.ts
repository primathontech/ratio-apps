import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { RatioClient } from '../../../core/ratio-client/ratio.client';
import { GOOGLE_RATIO } from '../tokens';
import { RatioTokenProvider } from '../google-oauth/ratio-token.provider';
import type { RatioProductsPort } from './feed-sync.service';
import { parseRestProduct } from './parse-ratio-product';
import type { RatioProduct } from './product-mapper';

// Loose envelope: the REST list endpoint returns `{ success, data, pagination }`.
// Field-level mapping is delegated to `parseRestProduct`, so each item is just an
// opaque record here.
const listSchema = z
  .object({
    success: z.boolean().optional(),
    data: z.array(z.record(z.string(), z.unknown())),
    pagination: z.object({ page: z.number(), totalPages: z.number() }).optional(),
  })
  .passthrough();

/**
 * Concrete {@link RatioProductsPort}: resolves a fresh merchant Ratio access
 * token via {@link RatioTokenProvider} (which refreshes + rotates expired tokens),
 * pages `GET /api/v1/products` filtered to active/published products with
 * variants, and maps each REST item into the mapper's `RatioProduct` via
 * {@link parseRestProduct} (prices are rupees — no division).
 */
@Injectable()
export class RatioProductsService implements RatioProductsPort {
  private readonly pageSize = 100;

  constructor(
    private readonly tokens: RatioTokenProvider,
    @Inject(GOOGLE_RATIO) private readonly ratio: RatioClient,
  ) {}

  async listAll(merchantId: string): Promise<RatioProduct[]> {
    const accessToken = await this.tokens.getAccessToken(merchantId);

    const out: RatioProduct[] = [];
    for (let page = 1; ; page++) {
      const res = await this.ratio.request(
        `/api/v1/products?limit=${this.pageSize}&page=${page}&status=active&published=true&show_variants=true`,
        listSchema,
        { accessToken },
      );
      for (const item of res.data) {
        const mapped = parseRestProduct(item);
        if (mapped) out.push(mapped);
      }

      if (res.pagination) {
        if (page >= res.pagination.totalPages) break;
      } else if (res.data.length < this.pageSize) {
        // No pagination metadata — stop on a short page.
        break;
      }
    }
    return out;
  }
}
