import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { UnicommerceDatabase } from '../db/types';
import { UC_DB_TOKEN } from '../kysely.module';

export interface UcConfig {
  productSyncEnabled: boolean;
  inventorySyncEnabled: boolean;
  orderPushEnabled: boolean;
  dispatchStatusSyncEnabled: boolean;
  cancelSyncEnabled: boolean;
  notificationsEnabled: boolean;
}

/**
 * Partial write shape for `upsert`. Explicitly allows `undefined` values (not
 * just absent keys) so a Zod-validated request body (`z.infer` yields
 * `boolean | undefined` per optional field) is directly assignable under
 * `exactOptionalPropertyTypes`.
 */
export type UcConfigPatch = {
  [K in keyof UcConfig]?: boolean | undefined;
};

const EMPTY_CONFIG: UcConfig = {
  productSyncEnabled: false,
  inventorySyncEnabled: false,
  orderPushEnabled: false,
  dispatchStatusSyncEnabled: false,
  cancelSyncEnabled: false,
  notificationsEnabled: false,
};

/**
 * Per-merchant Unicommerce feature config, backed by `uc_configs` (keyed by
 * `merchant_id`, defaulting every flag to DISABLED). Replaces the old
 * global env-var feature gates so one merchant's flows can be toggled without
 * affecting any other merchant.
 *
 * `getByMerchantId` deliberately returns an all-false config rather than
 * throwing when no row exists — real inbound traffic must never be blocked by
 * a missing config row (every flag off is the safe default).
 */
@Injectable()
export class UcConfigService {
  constructor(@Inject(UC_DB_TOKEN) private readonly handle: KyselyClient<UnicommerceDatabase>) {}

  async getByMerchantId(merchantId: string): Promise<UcConfig> {
    const row = await this.handle.db
      .selectFrom('ucConfigs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (!row) return { ...EMPTY_CONFIG };
    return {
      productSyncEnabled: Boolean(row.productSyncEnabled),
      inventorySyncEnabled: Boolean(row.inventorySyncEnabled),
      orderPushEnabled: Boolean(row.orderPushEnabled),
      dispatchStatusSyncEnabled: Boolean(row.dispatchStatusSyncEnabled),
      cancelSyncEnabled: Boolean(row.cancelSyncEnabled),
      notificationsEnabled: Boolean(row.notificationsEnabled),
    };
  }

  async upsert(merchantId: string, input: UcConfigPatch): Promise<UcConfig> {
    await this.handle.db
      .insertInto('ucConfigs')
      .values({ merchantId, ...input } as never)
      .onDuplicateKeyUpdate({ ...input, updatedAt: sql`CURRENT_TIMESTAMP(3)` } as never)
      .execute();
    return this.getByMerchantId(merchantId);
  }
}
