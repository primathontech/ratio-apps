import { Inject, Injectable } from '@nestjs/common';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { FbtDatabase } from '../db/types';
import { FBT_DB_TOKEN } from '../kysely.module';

/**
 * The five counts the source app's dashboard reported. `activeBundles` is the
 * PUBLISHED count — keeping the source's field name so the admin screen ports
 * without a rename.
 */
export interface FbtDashboardSummary {
  activeBundles: number;
  draftBundles: number;
  pausedBundles: number;
  manualBundles: number;
  autoBundles: number;
}

@Injectable()
export class FbtDashboardService {
  constructor(@Inject(FBT_DB_TOKEN) private readonly handle: KyselyClient<FbtDatabase>) {}

  /**
   * One grouped query rather than five COUNT round-trips — the source app fired
   * five separate queries per dashboard load.
   */
  async summary(merchantId: string): Promise<FbtDashboardSummary> {
    const rows = await this.handle.db
      .selectFrom('fbt_bundles')
      .select((eb) => ['status', 'mode', eb.fn.count<number>('id').as('total')])
      .where('merchantId', '=', merchantId)
      .groupBy(['status', 'mode'])
      .execute();

    const out: FbtDashboardSummary = {
      activeBundles: 0,
      draftBundles: 0,
      pausedBundles: 0,
      manualBundles: 0,
      autoBundles: 0,
    };

    for (const row of rows) {
      // mysql2 may return COUNT() as a string; Number() keeps the API numeric.
      const n = Number(row.total);
      if (row.status === 'published') out.activeBundles += n;
      else if (row.status === 'draft') out.draftBundles += n;
      else if (row.status === 'paused') out.pausedBundles += n;
      // 'archived' intentionally contributes to no status metric.

      if (row.mode === 'manual') out.manualBundles += n;
      else if (row.mode === 'auto') out.autoBundles += n;
    }
    return out;
  }
}
