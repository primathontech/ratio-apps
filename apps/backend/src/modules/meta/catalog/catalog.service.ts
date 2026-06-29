import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { MetaConfigService } from '../config/config.service';
import type { MetaDatabase } from '../db/types';
import { META_DB_TOKEN } from '../kysely.module';
import { CatalogBatchService, type CatalogBatchRequest, type CatalogFailure } from './catalog-batch.service';
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
 * Normalize the actual platform webhook product shape → OsItemProduct.
 *
 * The platform webhook uses: variant_id (not id), sku_id (not sku),
 * warehouseQt[].quantity (not inventory_quantity), imageUrl string (not image
 * object), images[].url (not src). Transformer expects OsItemProduct field names.
 */
function normalizeWebhookProduct(raw: OsItemProduct): OsItemProduct {
  type Rec = Record<string, unknown>;
  const r = raw as unknown as Rec;

  // Product-level option names for option1/2/3 → option_values mapping.
  const optionNames: (string | null)[] = Array.isArray(r.options)
    ? (r.options as Rec[]).map((o) => (typeof o.name === 'string' ? o.name : null))
    : [];

  const variants = Array.isArray(r.variants)
    ? (r.variants as Rec[]).map((v) => {
        // Sum warehouse quantities for inventory.
        const warehouses = Array.isArray(v.warehouseQt) ? (v.warehouseQt as Rec[]) : [];
        const inventory = warehouses.reduce(
          (s, w) => s + (typeof w.quantity === 'number' ? w.quantity : 0),
          0,
        );
        // Map option1/2/3 → option_values.
        const optionValues: { name: string; value: string }[] = [];
        for (const [i, key] of (['option1', 'option2', 'option3'] as const).entries()) {
          const val = v[key];
          const name = optionNames[i];
          if (typeof val === 'string' && val && val !== 'Default Title' && name && name !== 'Title') {
            optionValues.push({ name, value: val });
          }
        }
        return {
          ...v,
          id: v.variant_id ?? v.id,
          sku: v.sku_id ?? v.sku,
          inventory_quantity: inventory,
          image: typeof v.imageUrl === 'string' ? { src: v.imageUrl } : v.image,
          option_values: optionValues,
        };
      })
    : [];

  const result: OsItemProduct = {
    ...raw,
    // Map top-level imageUrl string to the image object the transformer expects.
    image: raw.image ?? (typeof r.imageUrl === 'string' ? { src: r.imageUrl as string } : null),
    // No inventory system yet — always treat webhook products as in-stock.
    track_inventory: false,
  };
  if (variants.length > 0) result.variants = variants as unknown as NonNullable<OsItemProduct['variants']>;
  return result;
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
export class CatalogService implements OnModuleInit {
  private readonly logger = new Logger(CatalogService.name);
  /** Merchants whose full sync is currently running, and those asked to stop. */
  private readonly running = new Set<string>();
  private readonly cancelling = new Set<string>();

  constructor(
    @Inject(META_DB_TOKEN) private readonly handle: KyselyClient<MetaDatabase>,
    private readonly configs: MetaConfigService,
    private readonly transformer: CatalogTransformerService,
    private readonly batch: CatalogBatchService,
    private readonly source: CatalogSourceService,
  ) {}

  /**
   * On boot, any `running` row is stale — a sync can't survive a process
   * restart (the progress is in-memory). Flip them to `interrupted` so the
   * dashboard never shows a phantom forever-running sync.
   * (Single-instance assumption; revisit with a heartbeat for multi-instance.)
   */
  async onModuleInit(): Promise<void> {
    const res = await this.handle.db
      .updateTable('catalog_sync_log')
      .set({ status: 'interrupted', completedAt: sql<Date>`CURRENT_TIMESTAMP(3)` })
      .where('status', '=', 'running')
      .execute();
    const n = Number(res[0]?.numUpdatedRows ?? 0);
    if (n > 0) this.logger.warn({ msg: 'marked stale running syncs as interrupted on boot', count: n });
  }

  /** One webhook → apply immediately (awaited by the webhook handler). */
  async syncProductWebhook(
    merchantId: string,
    op: CatalogOp,
    meta: { eventType: string; productTitle?: string } = { eventType: 'product.updated' },
  ): Promise<{ sent: number; failed: number; skipped: number }> {
    const productId =
      op.product?.id ?? op.sourceProductId ?? '';

    if (op.action === 'upsert' && op.product) {
      op = { ...op, product: normalizeWebhookProduct(op.product) };
    }

    const result = await this.applyOps(merchantId, [op]);

    await this.logWebhookDelivery(merchantId, {
      eventType: meta.eventType,
      productId,
      productTitle: meta.productTitle ?? null,
      sent: result.sent,
      failed: result.failed,
      skipped: result.skipped,
    });

    return result;
  }

  /** Full sync: stream os-item pages → push each page → delete orphans. */
  async fullSync(merchantId: string, trigger = 'manual', force = false): Promise<{ total: number; sent: number; failed: number }> {
    this.logger.log({ msg: `catalog full sync started (trigger: ${trigger}${force ? ', force' : ''})`, merchantId });
    const logId = await this.startLog(merchantId, trigger);
    this.running.add(merchantId);
    this.cancelling.delete(merchantId); // clear any stale flag from a prior run
    const live = new Set<string>();
    let sent = 0;
    let failed = 0;
    let eligible = 0; // products that passed the transformer (active/published)
    const allFailures: CatalogFailure[] = [];
    try {
      // Accumulate products across os-item pages and push to Meta in fixed-size
      // batches (NOT per page). os-item caps pages at ~10 rows, so pushing per
      // page would make one Meta Catalog API call per ~10 products and trip the
      // per-minute batch rate limit (#80014). Buffering to BATCH keeps it to
      // ~1 call per 800 products. Buffered-but-unflushed products are NOT yet
      // recorded in catalog_items (we record only after a successful push), so a
      // mid-sync crash loses nothing — the next sync re-fetches from os-item (the
      // source of truth) and re-syncs them, and orphan deletion runs only on a
      // fully-completed sync.
      // Products per Meta batch flush. Env-tunable; clamped to Meta's 5000-item
      // items_batch ceiling. Default 800 (one Meta call per 800 products).
      const BATCH = Math.min(5000, Math.max(1, Number(process.env.META_CATALOG_BATCH_SIZE) || 800));
      let buffer: OsItemProduct[] = [];
      const flush = async (): Promise<void> => {
        if (!buffer.length) return;
        const chunk = buffer;
        buffer = [];
        const r = await this.applyOps(
          merchantId,
          chunk.map((product) => ({ action: 'upsert', product }) as CatalogOp),
          force,
        );
        sent += r.sent;
        failed += r.failed;
        eligible += r.sent + r.failed + r.skipped;
        allFailures.push(...r.failures);
      };

      const total = await this.source.eachPage(
        merchantId,
        async (products) => {
          for (const p of products) live.add(p.id);
          buffer.push(...products);
          if (buffer.length >= BATCH) await flush();
        },
        () => this.cancelling.has(merchantId),
      );
      await flush(); // push the remaining (< BATCH) products

      const cancelled = this.cancelling.has(merchantId);
      // Skip orphan deletion on a cancelled run — `live` is incomplete, so we'd
      // wrongly delete products from pages we never fetched.
      let orphanCount = 0;
      if (!cancelled) {
        const known = await this.allSourceIds(merchantId);
        const orphans = [...known].filter((id) => !live.has(id));
        orphanCount = orphans.length;
        if (orphans.length) {
          const r = await this.applyOps(merchantId, orphans.map((sourceProductId) => ({ action: 'delete', sourceProductId }) as CatalogOp));
          sent += r.sent;
          failed += r.failed;
          allFailures.push(...r.failures);
        }
      }

      const status = cancelled ? 'cancelled' : failed ? 'partial' : 'success';
      await this.finishLog(logId, status, eligible, sent, failed, allFailures);
      this.logger.log({ msg: cancelled ? 'full sync cancelled' : 'full sync complete', merchantId, fetched: total, eligible, sent, failed, orphans: orphanCount });
      return { total, sent, failed };
    } catch (err) {
      this.logger.error({ msg: 'full sync failed', merchantId, err });
      await this.finishLog(logId, 'failed', null, sent, failed, allFailures);
      throw err;
    } finally {
      this.running.delete(merchantId);
      this.cancelling.delete(merchantId);
    }
  }

  /**
   * Ask a running full sync to stop. It stops between os-item pages (no orphan
   * deletion runs), and the run is logged as `cancelled`. No-op if nothing is
   * running for this merchant.
   */
  requestStop(merchantId: string): { stopping: boolean } {
    if (!this.running.has(merchantId)) return { stopping: false };
    this.cancelling.add(merchantId);
    this.logger.log({ msg: 'catalog sync stop requested', merchantId });
    return { stopping: true };
  }

  /**
   * Fire a full sync in the background (for "Sync Now" / auto-sync on enable).
   * `force` re-pushes every product, bypassing the content-hash skip.
   */
  startFullSyncInBackground(merchantId: string, trigger = 'manual', force = false): void {
    void this.fullSync(merchantId, trigger, force).catch((err) =>
      this.logger.error({ msg: 'background full sync error', merchantId, err }),
    );
  }

  // ── shared core ─────────────────────────────────────────────────────────────
  // `force` = hard sync: re-send every product even if its content hash is
  // unchanged (the manual "Force resync" path; webhooks/normal sync leave it false).
  async applyOps(merchantId: string, ops: CatalogOp[], force = false): Promise<{ sent: number; failed: number; skipped: number; failures: CatalogFailure[] }> {
    const cfg = await this.configs.getCatalogConfig(merchantId);
    if (!cfg || !cfg.syncEnabled) {
      this.logger.warn({ msg: 'catalog op skipped — not configured / disabled', merchantId });
      return { sent: 0, failed: 0, skipped: ops.length, failures: [] };
    }

    const requests: CatalogBatchRequest[] = [];
    const itemRows: { merchantId: string; retailerId: string; sourceProductId: string; contentHash: string; lastStatus: string }[] = [];
    const deletedRetailerIds: string[] = [];
    let skipped = 0;

    const deleteSourceIds = ops.filter((o) => o.action === 'delete' && o.sourceProductId).map((o) => o.sourceProductId as string);

    // Per-merchant storefront base for product links; global env is the fallback.
    const base = cfg.storefrontUrl?.trim() || storefrontBase();
    const desired = new Map<string, { sourceProductId: string; hash: string; data: Record<string, unknown> }>();
    for (const op of ops) {
      if (op.action !== 'upsert' || !op.product) continue;
      const items = this.transformer.transform(op.product, cfg.productIdType, base);
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
      if (!force && prev?.contentHash === d.hash && prev.lastStatus === 'synced') {
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

    this.logger.log({
      msg: `catalog sync: ${desired.size} checked → ${skipped} unchanged (skipped in DB), ${itemRows.length} to send, ${deletedRetailerIds.length} to delete`,
      merchantId,
    });

    if (!requests.length) {
      this.logger.log({ msg: 'catalog sync: nothing to push — all products unchanged', merchantId });
      return { sent: 0, failed: 0, skipped, failures: [] };
    }

    this.logger.log({ msg: `catalog sync: sending ${requests.length} items to Meta`, merchantId, catalogId: cfg.catalogId });
    const res = await this.batch.send(cfg.catalogId, cfg.catalogAccessToken, requests);
    this.logger.log({ msg: `catalog sync: Meta response → accepted ${res.sent}, rejected ${res.failed}`, merchantId });
    const failedSet = new Set(res.failures.map((f) => f.retailerId));

    // Only record items Meta actually accepted as `synced`. Items that failed
    // are recorded as `error` (lastStatus != 'synced') so the next sync RETRIES
    // them instead of hash-skipping — otherwise a transient/permission failure
    // would silently strand products as "synced" that never reached the catalog.
    const synced = itemRows.filter((r) => !failedSet.has(r.retailerId));
    const errored = itemRows.filter((r) => failedSet.has(r.retailerId)).map((r) => ({ ...r, lastStatus: 'error' }));
    if (synced.length) await this.upsertItems(synced);
    if (errored.length) await this.upsertItems(errored);
    // Only mark deletes that succeeded.
    const okDeletes = deletedRetailerIds.filter((id) => !failedSet.has(id));
    if (okDeletes.length) await this.markDeleted(merchantId, okDeletes);

    return { sent: res.sent, failed: res.failed, skipped, failures: res.failures };
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

  async getWebhookDeliveries(merchantId: string, limit = 50) {
    return this.handle.db
      .selectFrom('webhook_delivery_log')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .execute();
  }

  private async logWebhookDelivery(
    merchantId: string,
    entry: {
      eventType: string;
      productId: string;
      productTitle: string | null;
      sent: number;
      failed: number;
      skipped: number;
    },
  ): Promise<void> {
    let status: string;
    let reason: string | null = null;
    if (entry.sent > 0) {
      status = entry.failed > 0 ? 'partial' : 'sent';
    } else if (entry.skipped > 0) {
      status = 'skipped';
      reason = 'no changes detected';
    } else if (entry.failed > 0) {
      status = 'failed';
    } else {
      status = 'ignored';
      reason = 'inactive / draft product or catalog not configured';
    }

    try {
      await this.handle.db
        .insertInto('webhook_delivery_log')
        .values({
          merchantId,
          eventType: entry.eventType,
          productId: entry.productId,
          productTitle: entry.productTitle,
          status,
          sentCount: entry.sent,
          failedCount: entry.failed,
          reason,
        })
        .execute();
    } catch (err) {
      // Never let logging break the webhook response.
      this.logger.warn({ msg: 'failed to write webhook delivery log', merchantId, err });
    }
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

  private async finishLog(
    id: number,
    status: string,
    total: number | null,
    success: number | null,
    errors: number | null,
    failures: CatalogFailure[] = [],
  ) {
    if (!id) return;
    await this.handle.db
      .updateTable('catalog_sync_log')
      .set({
        status,
        totalProducts: total,
        successCount: success,
        errorCount: errors,
        // Persist the per-item failure reasons (capped) into the `errors` JSON
        // column so the admin can show WHY products failed — not just a count.
        errors: JSON.stringify(failures.slice(0, 100)),
        completedAt: sql<Date>`CURRENT_TIMESTAMP(3)`,
      })
      .where('id', '=', id)
      .execute();
  }
}
