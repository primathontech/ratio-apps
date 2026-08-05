import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { FbtMerchantConfigInput } from '@ratio-app/shared/schemas/fbt-config';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { FbtDatabase, FbtMerchantConfigRow } from '../db/types';
import { FBT_DB_TOKEN } from '../kysely.module';

/** API response shape: the row with `Date` columns serialised to ISO strings. */
export interface FbtConfigOutput {
  merchantId: string;
  allowAutomaticRecommendation: boolean;
  recommendationCount: number;
  productExcludedList: string[];
  productsWidgetDisabledList: string[];
  uiConfig: Record<string, unknown> | null;
  syncFrequency: 'daily' | 'weekly';
  syncHourUtc: number;
  syncWeekday: number | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  previewBaseUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Per-merchant recommendation config, backed by `fbt_merchant_config`
 * (one row per merchant; `merchantId` IS the primary key).
 *
 * The row is seeded at install by `FbtBootstrap`, so reads expect it to exist
 * and a miss is a genuine 404 rather than a lazy-create path.
 */
@Injectable()
export class FbtConfigService {
  constructor(@Inject(FBT_DB_TOKEN) private readonly handle: KyselyClient<FbtDatabase>) {}

  async getByMerchantId(merchantId: string): Promise<FbtConfigOutput> {
    const row = await this.handle.db
      .selectFrom('fbt_merchant_config')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();

    if (!row) {
      throw new NotFoundException({
        message: 'no fbt config for merchant',
        error_code: 'CONFIG_NOT_FOUND',
      });
    }
    return this.toOutput(row);
  }

  /**
   * Update the merchant's config.
   *
   * Scheduling state (`nextRunAt`) is server-owned and is only touched when the
   * `allowAutomaticRecommendation` toggle actually CHANGES:
   *   - off → on : `nextRunAt = now`, so bundles appear on the next sweep tick
   *                rather than at the next 4 AM slot.
   *   - on → off : `nextRunAt = NULL`, so a later re-enable starts fresh instead
   *                of inheriting a stale past timestamp that fires immediately.
   *   - unchanged: left alone, so repeatedly saving unrelated fields cannot be
   *                used to jump the sweep queue.
   */
  async upsert(merchantId: string, input: FbtMerchantConfigInput): Promise<FbtConfigOutput> {
    const current = await this.handle.db
      .selectFrom('fbt_merchant_config')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();

    if (!current) {
      throw new NotFoundException({
        message: 'no fbt config for merchant',
        error_code: 'CONFIG_NOT_FOUND',
      });
    }

    const toggledOn = !current.allowAutomaticRecommendation && input.allowAutomaticRecommendation;
    const toggledOff = current.allowAutomaticRecommendation && !input.allowAutomaticRecommendation;

    // JSON columns are stringified explicitly — mysql2 does not do it for us,
    // and passing an array through inserts the literal text `[object Object]`.
    const values = {
      allowAutomaticRecommendation: input.allowAutomaticRecommendation,
      recommendationCount: input.recommendationCount,
      syncFrequency: input.syncFrequency,
      syncHourUtc: input.syncHourUtc,
      syncWeekday: input.syncWeekday,
      productExcludedList: JSON.stringify(input.productExcludedList),
      productsWidgetDisabledList: JSON.stringify(input.productsWidgetDisabledList),
      uiConfig: input.uiConfig === null ? null : JSON.stringify(input.uiConfig),
      previewBaseUrl: input.previewBaseUrl,
      ...(toggledOn ? { nextRunAt: new Date() } : {}),
      ...(toggledOff ? { nextRunAt: null } : {}),
    };

    await this.handle.db
      .updateTable('fbt_merchant_config')
      .set(values)
      .where('merchantId', '=', merchantId)
      .execute();

    return this.getByMerchantId(merchantId);
  }

  private toOutput(row: FbtMerchantConfigRow): FbtConfigOutput {
    return {
      merchantId: row.merchantId,
      // MySQL has no native BOOLEAN (TINYINT(1) under the hood), and this pool has
      // no mysql2 typeCast configured, so a live DB read returns 0/1, not true/false.
      // Wrap explicitly — same pattern as wizzy/config/config.service.ts.
      allowAutomaticRecommendation: Boolean(row.allowAutomaticRecommendation),
      recommendationCount: row.recommendationCount,
      productExcludedList: row.productExcludedList ?? [],
      productsWidgetDisabledList: row.productsWidgetDisabledList ?? [],
      uiConfig: row.uiConfig,
      syncFrequency: row.syncFrequency,
      syncHourUtc: row.syncHourUtc,
      syncWeekday: row.syncWeekday,
      nextRunAt: row.nextRunAt ? new Date(row.nextRunAt).toISOString() : null,
      lastRunAt: row.lastRunAt ? new Date(row.lastRunAt).toISOString() : null,
      previewBaseUrl: row.previewBaseUrl,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }
}
