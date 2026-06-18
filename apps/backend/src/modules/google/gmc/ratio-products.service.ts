import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { RatioClient } from '../../../core/ratio-client/ratio.client';
import type { GoogleDatabase } from '../db/types';
import { GOOGLE_CRYPTO, GOOGLE_RATIO } from '../tokens';
import { GOOGLE_DB_TOKEN } from '../kysely.module';
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
 * Concrete {@link RatioProductsPort}: reads the merchant's Ratio access token
 * from `oauth_tokens`, pages `GET /api/v1/products` filtered to active/published
 * products with variants, and maps each REST item into the mapper's
 * `RatioProduct` via {@link parseRestProduct} (prices are rupees — no division).
 */
@Injectable()
export class RatioProductsService implements RatioProductsPort {
  private readonly pageSize = 100;

  constructor(
    @Inject(GOOGLE_DB_TOKEN) private readonly handle: KyselyClient<GoogleDatabase>,
    @Inject(GOOGLE_CRYPTO) private readonly crypto: CryptoService,
    @Inject(GOOGLE_RATIO) private readonly ratio: RatioClient,
  ) {}

  async listAll(merchantId: string): Promise<RatioProduct[]> {
    const tokenRow = await this.handle.db
      .selectFrom('oauth_tokens')
      .select(['accessTokenEnc'])
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (!tokenRow) return [];
    const accessToken = this.crypto.decrypt(tokenRow.accessTokenEnc);

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
