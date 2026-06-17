import { Inject, Injectable } from '@nestjs/common';
import type { FeedItemStatus } from '@ratio-app/shared/schemas/google-config';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { GoogleDatabase } from '../db/types';
import { GOOGLE_DB_TOKEN } from '../kysely.module';

export interface FeedSummary {
  synced: number;
  warnings: number;
  errors: number;
  pending: number;
  lastSyncAt: string | null;
}

export interface FeedItemView {
  offerId: string;
  productId: string;
  variantId: string | null;
  title: string | null;
  status: FeedItemStatus;
  hasGtin: boolean;
  issue: string | null;
  lastSyncedAt: string | null;
}

/** Read-side queries that power the feed-details admin screen. */
@Injectable()
export class FeedQueryService {
  constructor(@Inject(GOOGLE_DB_TOKEN) private readonly handle: KyselyClient<GoogleDatabase>) {}

  async summary(merchantId: string): Promise<FeedSummary> {
    const rows = await this.handle.db
      .selectFrom('google_feed_items')
      .select(['status'])
      .where('merchantId', '=', merchantId)
      .execute();
    const count = (s: FeedItemStatus) => rows.filter((r) => r.status === s).length;

    const last = await this.handle.db
      .selectFrom('google_feed_items')
      .select(['lastSyncedAt'])
      .where('merchantId', '=', merchantId)
      .where('lastSyncedAt', 'is not', null)
      .orderBy('lastSyncedAt', 'desc')
      .limit(1)
      .executeTakeFirst();

    return {
      synced: count('SYNCED'),
      warnings: count('WARNING'),
      errors: count('ERROR'),
      pending: count('PENDING'),
      lastSyncAt: last?.lastSyncedAt ? new Date(last.lastSyncedAt).toISOString() : null,
    };
  }

  async items(
    merchantId: string,
    opts: { status?: FeedItemStatus; page: number; limit: number },
  ): Promise<{ items: FeedItemView[]; total: number }> {
    let base = this.handle.db
      .selectFrom('google_feed_items')
      .where('merchantId', '=', merchantId);
    if (opts.status) base = base.where('status', '=', opts.status);

    const totalRow = await base
      .select((eb) => eb.fn.countAll<number>().as('c'))
      .executeTakeFirst();

    const rows = await base
      .selectAll()
      .orderBy('updatedAt', 'desc')
      .limit(opts.limit)
      .offset((opts.page - 1) * opts.limit)
      .execute();

    return {
      total: Number(totalRow?.c ?? 0),
      items: rows.map((r) => ({
        offerId: r.offerId,
        productId: r.productId,
        variantId: r.variantId,
        title: r.title,
        status: r.status,
        hasGtin: Boolean(r.hasGtin),
        issue: r.issue,
        lastSyncedAt: r.lastSyncedAt ? new Date(r.lastSyncedAt).toISOString() : null,
      })),
    };
  }

  async history(merchantId: string, limit = 20) {
    const rows = await this.handle.db
      .selectFrom('google_sync_log')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      syncType: r.syncType,
      productsChecked: r.productsChecked,
      productsUpdated: r.productsUpdated,
      productsErrored: r.productsErrored,
      detail: r.detail,
      createdAt: new Date(r.createdAt).toISOString(),
    }));
  }
}
