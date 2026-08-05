import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { FbtBundleOutput } from '@ratio-app/shared/schemas/fbt-bundle';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { FbtBundleRow, FbtDatabase } from '../db/types';
import { FBT_DB_TOKEN } from '../kysely.module';
import { toBundleOutput } from './bundles.service';

/**
 * Resolves which bundle the storefront should render for a given product or
 * collection, and builds the admin's preview payload.
 *
 * Precedence (ported from the source app's `resolveBundleForLookup`):
 *   productId  → a published bundle whose scopeProductIds contains it
 *   collectionId → a published bundle whose scopeCollectionIds contains it
 *   fallback   → the merchant's all_products bundle
 *   otherwise  → 404
 *
 * Plan 5's public `/fbt/sdk/lookup/:merchantId` route reuses `resolve()` — keep
 * it free of admin-only concerns.
 */
@Injectable()
export class FbtBundleLookupService {
  constructor(@Inject(FBT_DB_TOKEN) private readonly handle: KyselyClient<FbtDatabase>) {}

  async resolve(
    merchantId: string,
    opts: { productId?: string; collectionId?: string },
  ): Promise<FbtBundleOutput> {
    let row: FbtBundleRow | undefined;

    if (opts.productId) {
      row = await this.findByProduct(merchantId, opts.productId);
    } else if (opts.collectionId) {
      row = await this.findByCollection(merchantId, opts.collectionId);
    }

    if (!row) row = await this.findAllProducts(merchantId);

    if (!row) {
      const identifier = opts.productId
        ? `productId: ${opts.productId}`
        : `collectionId: ${opts.collectionId ?? 'none'}`;
      throw new NotFoundException({
        message: `no active published bundle found for ${identifier}`,
        error_code: 'BUNDLE_NOT_FOUND',
      });
    }
    return toBundleOutput(row);
  }

  /**
   * Admin preview. Deliberately does NOT filter on status or the date window —
   * the point of preview is to inspect a draft or scheduled bundle before it
   * goes live.
   */
  async preview(
    merchantId: string,
    bundleId: string,
  ): Promise<{ bundle: FbtBundleOutput; productIds: string[] }> {
    const row = await this.handle.db
      .selectFrom('fbt_bundles')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .where('id', '=', bundleId)
      .limit(1)
      .executeTakeFirst();

    if (!row) {
      throw new NotFoundException({
        message: 'bundle not found',
        error_code: 'BUNDLE_NOT_FOUND',
      });
    }
    return {
      bundle: toBundleOutput(row),
      productIds: row.recommendationProductList ?? [],
    };
  }

  /**
   * JSON_CONTAINS, not LIKE '%"id"%'. The source app's LIKE was a substring scan
   * over JSON text: it breaks on any id containing a quote or bracket, and fails
   * by matching nothing rather than raising.
   *
   * The column name is written literally in each fragment rather than passed via
   * `sql.ref()`. `CamelCasePlugin` rewrites identifiers it recognises in the
   * query AST, and a `sql.ref()` inside a raw fragment is NOT reliably rewritten
   * — so a camelCase ref here can emit `scopeProductIds` and fail with "unknown
   * column". Two small literal branches beat one clever shared one.
   */
  private findByProduct(merchantId: string, productId: string) {
    return this.publishedAndInWindow(merchantId)
      .where('scopeType', '=', 'specific_product')
      .where(sql<boolean>`JSON_CONTAINS(scope_product_ids, JSON_QUOTE(${productId}))`)
      .limit(1)
      .executeTakeFirst();
  }

  private findByCollection(merchantId: string, collectionId: string) {
    return this.publishedAndInWindow(merchantId)
      .where('scopeType', '=', 'specific_collections')
      .where(sql<boolean>`JSON_CONTAINS(scope_collection_ids, JSON_QUOTE(${collectionId}))`)
      .limit(1)
      .executeTakeFirst();
  }

  private findAllProducts(merchantId: string) {
    return this.publishedAndInWindow(merchantId)
      .where('scopeType', '=', 'all_products')
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Common candidate filter: published, and now within [startDate, endDate]
   * where a NULL bound means unbounded. Newest first, so a merchant with two
   * overlapping bundles gets deterministic (and intuitive) resolution.
   */
  private publishedAndInWindow(merchantId: string) {
    const now = new Date();
    return this.handle.db
      .selectFrom('fbt_bundles')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .where('status', '=', 'published')
      .where((eb) => eb.or([eb('startDate', 'is', null), eb('startDate', '<=', now)]))
      .where((eb) => eb.or([eb('endDate', 'is', null), eb('endDate', '>=', now)]))
      .orderBy('createdAt', 'desc');
  }
}
