import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { MetaConfigService } from '../config/config.service';
import type { MetaDatabase } from '../db/types';
import { META_DB_TOKEN } from '../kysely.module';
import { CatalogBatchService, type CatalogBatchRequest } from './catalog-batch.service';
import { CatalogSourceService } from './catalog-source.service';
import { CatalogTransformerService } from './catalog-transformer.service';
import type { OsItemProduct } from './catalog.types';

/** A catalog op (from a webhook or a full-sync page). */
export interface CatalogOp {
  action: 'upsert' | 'delete';
  product?: OsItemProduct;
  sourceProductId?: string;
}

function storefrontBase(): string {
  return (process.env.RATIO_META_STOREFRONT_BASE_URL ?? 'https://storefront.example.com').replace(/\/+$/, '');
}

/**
 * Catalog sync engine (Phase 2) — NO queue. Catalog work streams directly:
 *  - syncProductWebhook : one product change → push to Meta immediately.
 *  - fullSync           : paginate os-item, push each PAGE directly (bounded
 *                         memory), then delete orphans. Run in the background.
 * `applyOps` is the shared core: transform → skip no-ops (content hash) →
 * delete orphans → push via Batch API → keep `catalog_items` current.
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    @Inject(META_DB_TOKEN) private readonly handle: KyselyClient<MetaDatabase>,
    private readonly configs: MetaConfigService,
    private readonly transformer: CatalogTransformerService,
    private readonly batch: CatalogBatchService,
    private readonly source: CatalogSourceService,
  ) {}

  /** One webhook → apply immediately (awaited by the webhook handler). */
  async syncProductWebhook(merchantId: string, op: CatalogOp): Promise<{ sent: number; failed: number; skipped: number }> {
    return this.applyOps(merchantId, [op]);
  }

  /** Full sync: stream os-item pages → push each page → delete orphans. */
  async fullSync(merchantId: string, trigger = 'manual'): Promise<{ total: number; sent: number; failed: number }> {
    const logId = await this.startLog(merchantId, trigger);
    const live = new Set<string>();
    let sent = 0;
    let failed = 0;
    try {
      const total = await this.source.eachPage(merchantId, async (products) => {
        for (const p of products) live.add(p.id);
        const r = await this.applyOps(merchantId, products.map((product) => ({ action: 'upsert', product }) as CatalogOp));
        sent += r.sent;
        failed += r.failed;
      });

      // Orphans: previously-synced products no longer upstream → delete.
      const known = await this.allSourceIds(merchantId);
      const orphans = [...known].filter((id) => !live.has(id));
      if (orphans.length) {
        const r = await this.applyOps(merchantId, orphans.map((sourceProductId) => ({ action: 'delete', sourceProductId }) as CatalogOp));
        sent += r.sent;
        failed += r.failed;
      }

      await this.finishLog(logId, failed ? 'partial' : 'success', total, sent, failed);
      this.logger.log({ msg: 'full sync complete', merchantId, total, sent, failed, orphans: orphans.length });
      return { total, sent, failed };
    } catch (err) {
      this.logger.error({ msg: 'full sync failed', merchantId, err });
      await this.finishLog(logId, 'failed', null, sent, failed);
      throw err;
    }
  }

  /** Fire a full sync in the background (for "Sync Now" / auto-sync on enable). */
  startFullSyncInBackground(merchantId: string, trigger = 'manual'): void {
    void this.fullSync(merchantId, trigger).catch((err) =>
      this.logger.error({ msg: 'background full sync error', merchantId, err }),
    );
  }

  // ── shared core ─────────────────────────────────────────────────────────────
  async applyOps(merchantId: string, ops: CatalogOp[]): Promise<{ sent: number; failed: number; skipped: number }> {
    const cfg = await this.configs.getCatalogConfig(merchantId);
    if (!cfg || !cfg.syncEnabled) {
      this.logger.warn({ msg: 'catalog op skipped — not configured / disabled', merchantId });
      return { sent: 0, failed: 0, skipped: ops.length };
    }

    const requests: CatalogBatchRequest[] = [];
    const itemRows: { merchantId: string; retailerId: string; sourceProductId: string; contentHash: string; lastStatus: string }[] = [];
    const deletedRetailerIds: string[] = [];
    let skipped = 0;

    const deleteSourceIds = ops.filter((o) => o.action === 'delete' && o.sourceProductId).map((o) => o.sourceProductId as string);

    const desired = new Map<string, { sourceProductId: string; hash: string; data: Record<string, unknown> }>();
    for (const op of ops) {
      if (op.action !== 'upsert' || !op.product) continue;
      const items = this.transformer.transform(op.product, cfg.productIdType, storefrontBase());
      if (items.length === 0) {
        deleteSourceIds.push(op.product.id); // draft/unpublished → remove if previously synced
        continue;
      }
      for (const item of items) {
        desired.set(item.retailerId, { sourceProductId: op.product.id, hash: this.hash(item), data: this.batch.toData(item) });
      }
    }

    const existing = await this.loadItems(merchantId, [...desired.keys()]);
    for (const [retailerId, d] of desired) {
      const prev = existing.get(retailerId);
      if (prev?.contentHash === d.hash && prev.lastStatus === 'synced') {
        skipped += 1;
        continue;
      }
      requests.push({ method: prev ? 'UPDATE' : 'CREATE', retailer_id: retailerId, data: d.data });
      itemRows.push({ merchantId, retailerId, sourceProductId: d.sourceProductId, contentHash: d.hash, lastStatus: 'synced' });
    }

    if (deleteSourceIds.length) {
      const rows = await this.loadItemsBySource(merchantId, deleteSourceIds);
      for (const r of rows) {
        requests.push({ method: 'DELETE', retailer_id: r.retailerId });
        deletedRetailerIds.push(r.retailerId);
      }
    }

    if (!requests.length) return { sent: 0, failed: 0, skipped };

    const res = await this.batch.send(cfg.catalogId, cfg.catalogAccessToken, requests);
    if (itemRows.length) await this.upsertItems(itemRows);
    if (deletedRetailerIds.length) await this.markDeleted(merchantId, deletedRetailerIds);
    return { ...res, skipped };
  }

  async getStatus(merchantId: string, limit = 10) {
    return this.handle.db
      .selectFrom('catalog_sync_log')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .orderBy('startedAt', 'desc')
      .limit(limit)
      .execute();
  }

  // ── catalog_items helpers ──────────────────────────────────────────────────
  private hash(obj: unknown): string {
    return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
  }

  private async loadItems(merchantId: string, retailerIds: string[]) {
    const map = new Map<string, { contentHash: string; lastStatus: string }>();
    if (!retailerIds.length) return map;
    const rows = await this.handle.db
      .selectFrom('catalog_items')
      .select(['retailerId', 'contentHash', 'lastStatus'])
      .where('merchantId', '=', merchantId)
      .where('retailerId', 'in', retailerIds)
      .execute();
    for (const r of rows) map.set(r.retailerId, { contentHash: r.contentHash, lastStatus: r.lastStatus });
    return map;
  }

  private async loadItemsBySource(merchantId: string, sourceProductIds: string[]) {
    if (!sourceProductIds.length) return [];
    return this.handle.db
      .selectFrom('catalog_items')
      .select(['retailerId'])
      .where('merchantId', '=', merchantId)
      .where('sourceProductId', 'in', sourceProductIds)
      .where('lastStatus', '<>', 'deleted')
      .execute();
  }

  private async allSourceIds(merchantId: string): Promise<Set<string>> {
    const rows = await this.handle.db
      .selectFrom('catalog_items')
      .select('sourceProductId')
      .distinct()
      .where('merchantId', '=', merchantId)
      .where('lastStatus', '<>', 'deleted')
      .execute();
    return new Set(rows.map((r) => r.sourceProductId));
  }

  private async upsertItems(rows: { merchantId: string; retailerId: string; sourceProductId: string; contentHash: string; lastStatus: string }[]) {
    await this.handle.db
      .insertInto('catalog_items')
      .values(rows.map((r) => ({ ...r, updatedAt: sql`CURRENT_TIMESTAMP(3)` as never })))
      .onDuplicateKeyUpdate({
        sourceProductId: sql`values(source_product_id)`,
        contentHash: sql`values(content_hash)`,
        lastStatus: sql`values(last_status)`,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .execute();
  }

  private async markDeleted(merchantId: string, retailerIds: string[]) {
    await this.handle.db
      .updateTable('catalog_items')
      .set({ lastStatus: 'deleted', updatedAt: sql`CURRENT_TIMESTAMP(3)` as never } as never)
      .where('merchantId', '=', merchantId)
      .where('retailerId', 'in', retailerIds)
      .execute();
  }

  private async startLog(merchantId: string, trigger: string): Promise<number> {
    const res = await this.handle.db
      .insertInto('catalog_sync_log')
      .values({ merchantId, trigger, status: 'running', startedAt: sql<Date>`CURRENT_TIMESTAMP(3)` })
      .executeTakeFirst();
    return Number(res.insertId ?? 0);
  }

  private async finishLog(id: number, status: string, total: number | null, success: number | null, errors: number | null) {
    if (!id) return;
    await this.handle.db
      .updateTable('catalog_sync_log')
      .set({
        status,
        totalProducts: total,
        successCount: success,
        errorCount: errors,
        completedAt: sql<Date>`CURRENT_TIMESTAMP(3)`,
      })
      .where('id', '=', id)
      .execute();
  }
}
