import { Inject, Injectable } from '@nestjs/common';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { WizzyDatabase } from '../db/types';
import { WIZZY_DB_TOKEN } from '../kysely.module';

type CatalogStatus = 'SYNCED' | 'PENDING' | 'ERROR' | 'DELETED';

export interface CatalogSummary {
  synced: number;
  errors: number;
  pending: number;
  deleted: number;
  lastSyncAt: string | null;
}

export interface CatalogItemView {
  productId: string;
  wizzyId: string;
  title: string | null;
  status: CatalogStatus;
  issue: string | null;
  lastSyncedAt: string | null;
}

const VALID_STATUSES: CatalogStatus[] = ['SYNCED', 'PENDING', 'ERROR', 'DELETED'];

/** Read-side queries that power the catalog-details admin screen. */
@Injectable()
export class CatalogQueryService {
  constructor(@Inject(WIZZY_DB_TOKEN) private readonly handle: KyselyClient<WizzyDatabase>) {}

  async summary(merchantId: string): Promise<CatalogSummary> {
    const rows = await this.handle.db
      .selectFrom('wizzy_catalog_items')
      .select(['status'])
      .where('merchantId', '=', merchantId)
      .execute();
    const count = (s: CatalogStatus) => rows.filter((r) => r.status === s).length;

    const last = await this.handle.db
      .selectFrom('wizzy_catalog_items')
      .select(['lastSyncedAt'])
      .where('merchantId', '=', merchantId)
      .where('lastSyncedAt', 'is not', null)
      .orderBy('lastSyncedAt', 'desc')
      .limit(1)
      .executeTakeFirst();

    return {
      synced: count('SYNCED'),
      errors: count('ERROR'),
      pending: count('PENDING'),
      deleted: count('DELETED'),
      lastSyncAt: last?.lastSyncedAt ? new Date(last.lastSyncedAt).toISOString() : null,
    };
  }

  async items(
    merchantId: string,
    opts: { status?: CatalogStatus; page: number; limit: number },
  ): Promise<{ items: CatalogItemView[]; total: number }> {
    let base = this.handle.db
      .selectFrom('wizzy_catalog_items')
      .where('merchantId', '=', merchantId);
    if (opts.status) base = base.where('status', '=', opts.status);

    const totalRow = await base.select((eb) => eb.fn.countAll<number>().as('c')).executeTakeFirst();

    const rows = await base
      .selectAll()
      .orderBy('updatedAt', 'desc')
      .limit(opts.limit)
      .offset((opts.page - 1) * opts.limit)
      .execute();

    return {
      total: Number(totalRow?.c ?? 0),
      items: rows.map((r) => ({
        productId: r.productId,
        wizzyId: r.wizzyId,
        title: r.title,
        status: r.status,
        issue: r.issue,
        lastSyncedAt: r.lastSyncedAt ? new Date(r.lastSyncedAt).toISOString() : null,
      })),
    };
  }

  async history(merchantId: string, limit = 20) {
    const rows = await this.handle.db
      .selectFrom('wizzy_sync_log')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      syncType: r.syncType,
      productsChecked: r.productsChecked,
      productsSynced: r.productsSynced,
      productsErrored: r.productsErrored,
      detail: r.detail,
      createdAt: new Date(r.createdAt).toISOString(),
    }));
  }

  isValidStatus(s: string): s is CatalogStatus {
    return VALID_STATUSES.includes(s as CatalogStatus);
  }
}
