import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type LoyaltyConfig,
  loyaltyConfigInputSchema,
} from '@ratio-app/shared/schemas/loyalty-config';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { LoyaltyDatabase } from '../db/types';
import { LOYALTY_DB_TOKEN } from '../kysely.module';
import { StorefrontConfigService } from '../storefront/storefront-config.service';

/**
 * Per-merchant Loyalty config CRUD. Backed by `loyalty_configs`, keyed by
 * `merchant_id` (single-tenant per-module DB — no `app` column).
 *
 * MySQL has no `RETURNING`, so writes use INSERT…ON DUPLICATE KEY UPDATE and
 * compose the response in memory from the validated input.
 */
@Injectable()
export class LoyaltyConfigService {
  constructor(
    @Inject(LOYALTY_DB_TOKEN) private readonly handle: KyselyClient<LoyaltyDatabase>,
    private readonly storefrontConfig: StorefrontConfigService,
  ) {}

  async getByMerchantId(merchantId: string): Promise<LoyaltyConfig> {
    const row = await this.handle.db
      .selectFrom('loyalty_configs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException({
        message: 'no loyalty config for merchant',
        error_code: 'CONFIG_NOT_FOUND',
      });
    }
    return {
      programName: row.programName,
      // DECIMAL columns come back from mysql2 as strings — coerce.
      baseEarnRate: Number(row.baseEarnRate),
      coinValueInr: Number(row.coinValueInr),
      ...(row.storefrontBaseUrl ? { storefrontBaseUrl: row.storefrontBaseUrl } : {}),
      ...(row.exportEmail ? { exportEmail: row.exportEmail } : {}),
    };
  }

  async upsert(merchantId: string, input: unknown): Promise<LoyaltyConfig> {
    const cfg = loyaltyConfigInputSchema.parse(input ?? {});

    await this.handle.db
      .insertInto('loyalty_configs')
      .values({
        merchantId,
        programName: cfg.programName,
        baseEarnRate: cfg.baseEarnRate,
        coinValueInr: cfg.coinValueInr,
        storefrontBaseUrl: cfg.storefrontBaseUrl ?? null,
        exportEmail: cfg.exportEmail ?? null,
      })
      .onDuplicateKeyUpdate({
        programName: cfg.programName,
        baseEarnRate: cfg.baseEarnRate,
        coinValueInr: cfg.coinValueInr,
        storefrontBaseUrl: cfg.storefrontBaseUrl ?? null,
        exportEmail: cfg.exportEmail ?? null,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .execute();

    // The public storefront config caches the row — bust it on every save.
    await this.storefrontConfig.invalidate(merchantId);

    return cfg;
  }
}
