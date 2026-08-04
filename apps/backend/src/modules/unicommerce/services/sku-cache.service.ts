import { Inject, Injectable } from '@nestjs/common';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { UnicommerceDatabase } from '../db/types';
import { UC_DB_TOKEN } from '../kysely.module';

@Injectable()
export class UcSkuCacheService {
  constructor(@Inject(UC_DB_TOKEN) private readonly handle: KyselyClient<UnicommerceDatabase>) {}

  async resolve(merchantId: string, sku: string): Promise<string | null> {
    const row = await this.handle.db
      .selectFrom('ucSkuCache')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .where('sku', '=', sku)
      .executeTakeFirst();
    return row?.ratioVariantId ?? null;
  }

  async upsert(
    merchantId: string,
    sku: string,
    variantId: string,
    productId: string,
  ): Promise<void> {
    await this.handle.db
      .insertInto('ucSkuCache')
      .values({ merchantId, sku, ratioVariantId: variantId, ratioProductId: productId })
      .onDuplicateKeyUpdate({ ratioVariantId: variantId, ratioProductId: productId })
      .execute();
  }

  /**
   * One-time backfill, called from the OAuth install bootstrap and available
   * for a manual "resync" admin action. Paginates through the FULL catalog —
   * `GET /api/v1/v1/products` has no upper bound on total products, so this
   * must loop until a short page confirms the end, not assume one page.
   */
  async backfill(
    merchantId: string,
    ratio: {
      listAllVariants(): AsyncGenerator<{ sku: string; variantId: string; productId: string }>;
    },
  ): Promise<number> {
    let count = 0;
    for await (const v of ratio.listAllVariants()) {
      await this.upsert(merchantId, v.sku, v.variantId, v.productId);
      count += 1;
    }
    return count;
  }
}
