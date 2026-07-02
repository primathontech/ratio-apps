import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { RedisService } from '../../../core/cache/redis.service';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { WizzyDatabase } from '../db/types';
import { WIZZY_DB_TOKEN } from '../kysely.module';
import { WIZZY_CRYPTO, WIZZY_RATIO_PRODUCTS } from '../tokens';
import { WizzyApiClient, WizzyApiError } from './wizzy-api.client';
import type { RatioProduct, WizzyProductPayload } from './wizzy-transform';
import { transformProduct, type WizzyTransformConfig } from './wizzy-transform';

/** Seam over "read this merchant's full Ratio product catalog". */
export interface RatioProductsPort {
  listAll(merchantId: string): Promise<RatioProduct[]>;
  getById(
    merchantId: string,
    productId: string,
    opts?: { logRaw?: boolean },
  ): Promise<RatioProduct>;
}

type SyncType = 'webhook' | 'auto' | 'reconcile' | 'initial' | 'manual';

/** Cross-instance full-sync lock TTL — a safety net so a crashed sync can't
 * hold the lock forever. Generous: a full catalog sync (by-id enrichment) is slow. */
const SYNC_LOCK_TTL_S = 1800;
const syncLockKey = (merchantId: string) => `wizzy:sync:lock:${merchantId}`;

/**
 * Whether a Wizzy push failure is worth retrying.
 * Transient failures (rate-limit, 5xx, or a non-HTTP network error) should
 * redeliver via the SQS visibility timeout. Permanent failures (4xx) must NOT.
 */
function isTransientWizzyError(err: unknown): boolean {
  if (err instanceof WizzyApiError) {
    return err.isTransient;
  }
  // Network error, timeout, or anything before an HTTP status.
  return true;
}

/**
 * Pushes the Ratio catalog to Wizzy's indexing API and keeps
 * `wizzy_catalog_items` / `wizzy_sync_log` in step.
 *
 * Per-product webhook work is enqueued on a durable SQS queue by the webhook
 * handlers and drained by a separate worker that calls {@link syncProduct} /
 * {@link deleteProduct}. Bulk paths ({@link fullSync}) batch via
 * `WizzyApiClient.saveProducts`.
 *
 * Credential resolution (mirrors google's GMC_STORE_URL env-fallback pattern):
 *   1. Per-merchant DB config (storeId / decrypted storeSecret / decrypted apiKey)
 *   2. Env fallback: WIZZY_STORE_ID / WIZZY_STORE_SECRET / WIZZY_API_KEY
 * If any of the three is still missing after fallback the sync is skipped (no-op
 * with a clear log message — never crashes).
 */
@Injectable()
export class CatalogSyncService {
  private readonly logger = new Logger(CatalogSyncService.name);

  /**
   * Merchants with a full sync running on THIS instance — an in-memory guard so
   * repeated Force Sync clicks can't kick off overlapping syncs. Claimed
   * synchronously (no await between check + add) so it's race-free per instance.
   * Redis ({@link SYNC_LOCK_TTL_S}) extends the guard across instances.
   */
  private readonly inProgress = new Set<string>();

  constructor(
    @Inject(WIZZY_DB_TOKEN) private readonly handle: KyselyClient<WizzyDatabase>,
    private readonly wizzy: WizzyApiClient,
    @Inject(WIZZY_RATIO_PRODUCTS) private readonly products: RatioProductsPort,
    @Inject(WIZZY_CRYPTO) private readonly crypto: CryptoService,
    private readonly redis: RedisService,
  ) {}

  /** Transform + push one product; records per-item catalog status. */
  async syncProduct(
    merchantId: string,
    product: RatioProduct,
    syncType: SyncType = 'webhook',
  ): Promise<{ updated: number; errored: number }> {
    const ctx = await this.context(merchantId);
    if (!ctx) return { updated: 0, errored: 0 };

    // Auto-sync gate: when "Auto-sync on product changes" is OFF, product-change
    // events (webhook/auto) must NOT sync. Explicit syncs (manual/initial/force/
    // reconcile) are unaffected — they reconcile on demand.
    if ((syncType === 'webhook' || syncType === 'auto') && !ctx.autoSyncEnabled) {
      this.logger.log({
        msg: 'auto-sync disabled — skipping product change',
        merchantId,
        productId: product.id,
        syncType,
      });
      return { updated: 0, errored: 0 };
    }

    const result = transformProduct(product, ctx.transformConfig);
    if (!result.ok) {
      // Product filtered — missing image or all variants out of stock.
      await this.writeCatalogItem(
        merchantId,
        product.id,
        product.id,
        product.title,
        result.issue === 'missing image' ? 'ERROR' : 'DELETED',
        result.issue,
      );
      await this.writeSyncLog(
        merchantId,
        syncType,
        1,
        0,
        result.issue === 'missing image' ? 1 : 0,
        `product filtered: ${result.issue}`,
      );
      return { updated: 0, errored: result.issue === 'missing image' ? 1 : 0 };
    }

    let updated = 0;
    let errored = 0;

    try {
      await this.wizzy.saveProducts(ctx.storeId, ctx.storeSecret, ctx.apiKey, [result.payload]);
      await this.writeCatalogItem(
        merchantId,
        product.id,
        product.id,
        product.title,
        'SYNCED',
        null,
      );
      updated += 1;
    } catch (err) {
      if (isTransientWizzyError(err)) {
        this.logger.warn({
          msg: 'Wizzy transient error — leaving message for redrive',
          merchantId,
          productId: product.id,
          err: `${err}`,
        });
        throw err;
      }
      // Permanent (4xx validation): record ERROR and move on.
      const issue = err instanceof WizzyApiError ? err.message : `${err}`;
      await this.writeCatalogItem(
        merchantId,
        product.id,
        product.id,
        product.title,
        'ERROR',
        issue,
      );
      errored += 1;
    }

    await this.writeSyncLog(merchantId, syncType, 1, updated, errored);
    return { updated, errored };
  }

  /** Delete a product from Wizzy and mark DELETED in catalog_items. */
  async deleteProduct(merchantId: string, productId: string): Promise<void> {
    const ctx = await this.context(merchantId);
    if (!ctx) return;

    // Auto-sync gate: a delete is a product-change event. When "Auto-sync on
    // product changes" is OFF, skip it — a later manual/force sync reconciles.
    if (!ctx.autoSyncEnabled) {
      this.logger.log({ msg: 'auto-sync disabled — skipping product delete', merchantId, productId });
      return;
    }

    try {
      await this.wizzy.deleteProducts(ctx.storeId, ctx.storeSecret, ctx.apiKey, [productId]);
    } catch (err) {
      if (isTransientWizzyError(err)) {
        this.logger.warn({
          msg: 'Wizzy delete transient error — leaving message for redrive',
          merchantId,
          productId,
          err: `${err}`,
        });
        throw err;
      }
      this.logger.warn({ msg: 'wizzy delete failed', merchantId, productId, err: `${err}` });
    }

    await this.handle.db
      .updateTable('wizzy_catalog_items')
      .set({ status: 'DELETED', updatedAt: sql`CURRENT_TIMESTAMP(3)` } as never)
      .where('merchantId', '=', merchantId)
      .where('productId', '=', productId)
      .execute();
    await this.writeSyncLog(merchantId, 'webhook', 1, 0, 0);
  }

  /** Full-catalog batch sync (on connect / Force Sync / reconcile). */
  async fullSync(
    merchantId: string,
    syncType: SyncType,
  ): Promise<{ updated: number; errored: number }> {
    // De-dupe overlapping full syncs (e.g. repeated Force Sync clicks): only one
    // runs per merchant; further triggers no-op until it finishes. The in-memory
    // claim is synchronous (race-free per instance); Redis extends it across
    // instances (and auto-expires via TTL if a sync crashes mid-run).
    if (this.inProgress.has(merchantId)) {
      this.logger.warn({ msg: 'fullSync skipped — already in progress', merchantId, syncType });
      return { updated: 0, errored: 0 };
    }
    this.inProgress.add(merchantId);
    try {
      const gotLock = await this.redis.firstSeen(syncLockKey(merchantId), SYNC_LOCK_TTL_S);
      if (!gotLock) {
        this.logger.warn({
          msg: 'fullSync skipped — already in progress (another instance)',
          merchantId,
          syncType,
        });
        return { updated: 0, errored: 0 };
      }
      try {
        const ctx = await this.context(merchantId);
        if (!ctx) {
          const detail = 'Wizzy not enabled or credentials missing';
          this.logger.warn({ msg: 'fullSync skipped', merchantId, detail });
          await this.writeSyncLog(merchantId, syncType, 0, 0, 0, detail);
          return { updated: 0, errored: 0 };
        }
        try {
          return await this.runFullSync(merchantId, syncType, ctx);
        } catch (err) {
          const detail = err instanceof Error ? err.message : `${err}`;
          this.logger.error({ msg: 'fullSync failed', merchantId, syncType, detail });
          await this.writeSyncLog(merchantId, syncType, 0, 0, 0, `sync failed: ${detail}`);
          throw err;
        }
      } finally {
        await this.redis.del(syncLockKey(merchantId));
      }
    } finally {
      this.inProgress.delete(merchantId);
    }
  }

  private async runFullSync(
    merchantId: string,
    syncType: SyncType,
    ctx: NonNullable<Awaited<ReturnType<CatalogSyncService['context']>>>,
  ): Promise<{ updated: number; errored: number }> {
    const shallowCatalog = await this.products.listAll(merchantId);

    // Mark every product PENDING up-front — we already have all ids from listAll,
    // so the catalog UI shows in-progress status while the (slower) by-id
    // enrichment + Wizzy save run. Each product is flipped to its terminal status
    // (SYNCED/ERROR/DELETED) chunk-by-chunk, so the PENDING count ticks down live.
    await this.markAllPending(merchantId, shallowCatalog);

    // Concurrency for by-id enrichment: env-configurable, default 10.
    const CONCURRENCY = Number(process.env.WIZZY_SYNC_CONCURRENCY) || 10;

    let synced = 0;
    let errored = 0;

    // Process shallowCatalog in chunks of CONCURRENCY. Each chunk is fully
    // enriched, transformed, saved, and written to DB before the next chunk
    // starts — so PENDING count decreases visibly as products complete.
    for (let i = 0; i < shallowCatalog.length; i += CONCURRENCY) {
      const chunk = shallowCatalog.slice(i, i + CONCURRENCY);

      // (a) Enrich in parallel; fall back to shallow item on getById failure.
      const enriched: RatioProduct[] = await Promise.all(
        chunk.map((p) =>
          this.products.getById(merchantId, p.id).catch((err: unknown) => {
            this.logger.warn({
              msg: 'wizzy getById failed — shallow fallback',
              merchantId,
              productId: p.id,
              err: `${err}`,
            });
            return p;
          }),
        ),
      );

      // (b) Transform: partition into saveable and failures.
      const saveable: { product: RatioProduct; payload: WizzyProductPayload }[] = [];
      const failures: { product: RatioProduct; status: 'ERROR' | 'DELETED'; issue: string }[] = [];

      for (const product of enriched) {
        const result = transformProduct(product, ctx.transformConfig);
        if (result.ok) {
          saveable.push({ product, payload: result.payload });
        } else {
          failures.push({
            product,
            status: result.issue === 'missing image' ? 'ERROR' : 'DELETED',
            issue: result.issue,
          });
        }
      }

      // (c) Save the chunk's saveable products; on error mark them ERROR (no re-throw).
      let saveError: string | null = null;
      if (saveable.length > 0) {
        try {
          await this.wizzy.saveProducts(
            ctx.storeId,
            ctx.storeSecret,
            ctx.apiKey,
            saveable.map((s) => s.payload),
          );
        } catch (err) {
          this.logger.error({ msg: 'wizzy chunk save failed', merchantId, err: `${err}` });
          saveError = err instanceof WizzyApiError ? err.message : `${err}`;
        }
      }

      // (d) Write terminal status for THIS chunk — makes PENDING tick down live.
      for (const f of failures) {
        if (f.status === 'ERROR') errored += 1;
        // DELETED counts as neither synced nor errored (matching prior logic).
        await this.writeCatalogItem(
          merchantId,
          f.product.id,
          f.product.id,
          f.product.title,
          f.status,
          f.issue,
        );
      }
      for (const s of saveable) {
        const status = saveError === null ? 'SYNCED' : 'ERROR';
        const issue = saveError;
        if (status === 'SYNCED') synced += 1;
        else errored += 1;
        await this.writeCatalogItem(
          merchantId,
          s.product.id,
          s.product.id,
          s.product.title,
          status,
          issue,
        );
      }
    }

    // Update last_bulk_sync_at
    await this.handle.db
      .updateTable('wizzy_configs')
      .set({
        lastBulkSyncAt: sql`CURRENT_TIMESTAMP(3)`,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .where('merchantId', '=', merchantId)
      .execute();

    await this.writeSyncLog(merchantId, syncType, shallowCatalog.length, synced, errored);
    this.logger.log({
      msg: 'fullSync complete',
      merchantId,
      syncType,
      products: shallowCatalog.length,
      synced,
      errored,
    });
    return { updated: synced, errored };
  }

  initialSync(merchantId: string): Promise<{ updated: number; errored: number }> {
    return this.fullSync(merchantId, 'initial');
  }

  forceSync(merchantId: string): Promise<{ updated: number; errored: number }> {
    return this.fullSync(merchantId, 'manual');
  }

  /** True while a full sync is running for this merchant on THIS instance —
   * lets the controller reject a duplicate Force Sync and the admin disable the
   * button. (Cleared in `fullSync`'s finally, so a failed sync frees it.) */
  isSyncing(merchantId: string): boolean {
    return this.inProgress.has(merchantId);
  }

  /**
   * Resolve per-merchant Wizzy credentials + transform config, or null if
   * wizzy is not enabled / credentials are missing.
   *
   * Credential resolution order (mirrors google's GMC_STORE_URL env-fallback):
   *   1. DB config (per-merchant storeId / decrypted storeSecret / decrypted apiKey)
   *   2. Env fallback: WIZZY_STORE_ID / WIZZY_STORE_SECRET / WIZZY_API_KEY
   *
   * If any of the three is still missing → returns null with a log message.
   */
  private async context(merchantId: string): Promise<{
    storeId: string;
    storeSecret: string;
    apiKey: string;
    autoSyncEnabled: boolean;
    transformConfig: WizzyTransformConfig;
  } | null> {
    const config = await this.handle.db
      .selectFrom('wizzy_configs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();

    if (!config?.wizzyEnabled) return null;

    // Resolve credentials with env fallback.
    const storeId = config.storeId || process.env.WIZZY_STORE_ID || '';
    const storeSecret = config.storeSecretEnc
      ? this.crypto.decrypt(config.storeSecretEnc)
      : (process.env.WIZZY_STORE_SECRET ?? '');
    const apiKey = config.apiKeyEnc
      ? this.crypto.decrypt(config.apiKeyEnc)
      : (process.env.WIZZY_API_KEY ?? '');

    if (!storeId || !storeSecret || !apiKey) {
      this.logger.warn({
        msg: 'wizzy creds not configured — skipping sync',
        merchantId,
        hasStoreId: Boolean(storeId),
        hasStoreSecret: Boolean(storeSecret),
        hasApiKey: Boolean(apiKey),
      });
      return null;
    }

    return {
      storeId,
      storeSecret,
      apiKey,
      autoSyncEnabled: Boolean(config.autoSyncEnabled),
      transformConfig: {
        stripHtmlDescription: Boolean(config.stripHtmlDescription),
        includeOutOfStock: Boolean(config.includeOutOfStock),
        storeDomain: config.storeUrl ?? null,
      },
    };
  }

  /**
   * Bulk-mark all products PENDING in one upsert (called right after listAll, so
   * the catalog UI reflects an in-progress sync). Existing rows flip to PENDING;
   * the per-product terminal status is written later in the same run.
   */
  private async markAllPending(
    merchantId: string,
    products: { id: string; title?: string }[],
  ): Promise<void> {
    if (products.length === 0) return;
    await this.handle.db
      .insertInto('wizzy_catalog_items')
      .values(
        products.map((p) => ({
          merchantId,
          productId: p.id,
          wizzyId: p.id,
          title: (p.title ?? '').slice(0, 255) || null,
          status: 'PENDING',
          issue: null,
          lastSyncedAt: null,
        })) as never,
      )
      .onDuplicateKeyUpdate({
        status: 'PENDING',
        issue: null,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .execute();
  }

  private async writeCatalogItem(
    merchantId: string,
    productId: string,
    wizzyId: string,
    title: string | undefined,
    status: 'SYNCED' | 'PENDING' | 'ERROR' | 'DELETED',
    issue: string | null,
  ): Promise<void> {
    // `issue` is varchar(512). A Wizzy validation error can list every product
    // in the failed batch (far over 512 chars) — truncate so the write never
    // throws "Data too long", which would otherwise strand the product in
    // PENDING and abort the whole sync.
    const safeIssue = issue === null ? null : issue.slice(0, 500);
    const safeTitle = (title ?? '').slice(0, 255) || null;
    await this.handle.db
      .insertInto('wizzy_catalog_items')
      .values({
        merchantId,
        productId,
        wizzyId,
        title: safeTitle,
        status,
        issue: safeIssue,
        lastSyncedAt: status === 'SYNCED' ? sql`CURRENT_TIMESTAMP(3)` : null,
      } as never)
      .onDuplicateKeyUpdate({
        wizzyId,
        title: safeTitle,
        status,
        issue: safeIssue,
        ...(status === 'SYNCED' ? { lastSyncedAt: sql`CURRENT_TIMESTAMP(3)` } : {}),
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .execute();
  }

  private async writeSyncLog(
    merchantId: string,
    syncType: SyncType,
    checked: number,
    synced: number,
    errored: number,
    detail?: string,
  ): Promise<void> {
    // `detail` is varchar(512) — truncate so a long error never overflows.
    const safeDetail = (detail ?? `${synced} synced, ${errored} errors`).slice(0, 500);
    await this.handle.db
      .insertInto('wizzy_sync_log')
      .values({
        merchantId,
        syncType,
        productsChecked: checked,
        productsSynced: synced,
        productsErrored: errored,
        detail: safeDetail,
      } as never)
      .execute();
  }
}
