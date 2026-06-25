import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
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
}

type SyncType = 'webhook' | 'auto' | 'reconcile' | 'initial' | 'manual';

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

  constructor(
    @Inject(WIZZY_DB_TOKEN) private readonly handle: KyselyClient<WizzyDatabase>,
    private readonly wizzy: WizzyApiClient,
    @Inject(WIZZY_RATIO_PRODUCTS) private readonly products: RatioProductsPort,
    @Inject(WIZZY_CRYPTO) private readonly crypto: CryptoService,
  ) {}

  /** Transform + push one product; records per-item catalog status. */
  async syncProduct(
    merchantId: string,
    product: RatioProduct,
    syncType: SyncType = 'webhook',
  ): Promise<{ updated: number; errored: number }> {
    const ctx = await this.context(merchantId);
    if (!ctx) return { updated: 0, errored: 0 };

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
  }

  private async runFullSync(
    merchantId: string,
    syncType: SyncType,
    ctx: NonNullable<Awaited<ReturnType<CatalogSyncService['context']>>>,
  ): Promise<{ updated: number; errored: number }> {
    const catalog = await this.products.listAll(merchantId);
    let updated = 0;
    let errored = 0;

    // Transform all products, collecting payloads and per-product results.
    const syncable: WizzyProductPayload[] = [];
    for (const product of catalog) {
      const result = transformProduct(product, ctx.transformConfig);
      if (result.ok) {
        syncable.push(result.payload);
      }
    }

    if (syncable.length > 0) {
      // Chunk into batches of 100 to avoid very large request bodies.
      const BATCH_SIZE = 100;
      for (let i = 0; i < syncable.length; i += BATCH_SIZE) {
        const batch = syncable.slice(i, i + BATCH_SIZE);
        try {
          await this.wizzy.saveProducts(ctx.storeId, ctx.storeSecret, ctx.apiKey, batch);
          updated += batch.length;
        } catch (err) {
          this.logger.error({ msg: 'wizzy batch save failed', merchantId, err: `${err}` });
          errored += batch.length;
        }
      }
    }

    // Upsert catalog items for all products in this sync.
    for (const product of catalog) {
      const result = transformProduct(product, ctx.transformConfig);
      const status = result.ok ? 'SYNCED' : result.issue === 'missing image' ? 'ERROR' : 'DELETED';
      const issue = result.ok ? null : result.issue;
      await this.writeCatalogItem(merchantId, product.id, product.id, product.title, status, issue);
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

    await this.writeSyncLog(merchantId, syncType, catalog.length, updated, errored);
    this.logger.log({
      msg: 'fullSync complete',
      merchantId,
      syncType,
      products: catalog.length,
      updated,
      errored,
    });
    return { updated, errored };
  }

  initialSync(merchantId: string): Promise<{ updated: number; errored: number }> {
    return this.fullSync(merchantId, 'initial');
  }

  forceSync(merchantId: string): Promise<{ updated: number; errored: number }> {
    return this.fullSync(merchantId, 'manual');
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
      transformConfig: {
        stripHtmlDescription: Boolean(config.stripHtmlDescription),
        includeOutOfStock: Boolean(config.includeOutOfStock),
        storeDomain: config.storeUrl ?? null,
      },
    };
  }

  private async writeCatalogItem(
    merchantId: string,
    productId: string,
    wizzyId: string,
    title: string | undefined,
    status: 'SYNCED' | 'PENDING' | 'ERROR' | 'DELETED',
    issue: string | null,
  ): Promise<void> {
    await this.handle.db
      .insertInto('wizzy_catalog_items')
      .values({
        merchantId,
        productId,
        wizzyId,
        title: (title ?? '').slice(0, 255) || null,
        status,
        issue,
        lastSyncedAt: status === 'SYNCED' ? sql`CURRENT_TIMESTAMP(3)` : null,
      } as never)
      .onDuplicateKeyUpdate({
        wizzyId,
        title: (title ?? '').slice(0, 255) || null,
        status,
        issue,
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
    await this.handle.db
      .insertInto('wizzy_sync_log')
      .values({
        merchantId,
        syncType,
        productsChecked: checked,
        productsSynced: synced,
        productsErrored: errored,
        detail: detail ?? `${synced} synced, ${errored} errors`,
      } as never)
      .execute();
  }
}
