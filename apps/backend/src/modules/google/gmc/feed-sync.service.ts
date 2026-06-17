import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { GoogleDatabase } from '../db/types';
import { GOOGLE_DB_TOKEN } from '../kysely.module';
import { GOOGLE_RATIO_PRODUCTS } from '../tokens';
import { GoogleAuthService } from '../google-oauth/google-auth.service';
import {
  ContentApiClient,
  ContentApiError,
  type BatchEntry,
} from './content-api.client';
import { type MappedOffer, mapProduct, type RatioProduct } from './product-mapper';

/** Seam over "read this merchant's full Ratio product catalog". */
export interface RatioProductsPort {
  listAll(merchantId: string): Promise<RatioProduct[]>;
}

type SyncType = 'webhook' | 'auto' | 'reconcile' | 'initial' | 'manual';

/**
 * Pushes the Ratio catalog to Google Merchant Center via the Content API and
 * keeps `google_feed_items` / `google_sync_log` in step.
 *
 * Webhook handlers call {@link enqueuePush} / {@link enqueueDelete}, which write
 * the feed item synchronously (so the handler's transaction commits fast — the
 * Ratio 5s budget, TRD R5) and defer the network push to a microtask AFTER the
 * 200 ack. Bulk paths ({@link initialSync}, {@link forceSync}) batch via
 * `products.custombatch` in chunks of 1000.
 */
@Injectable()
export class FeedSyncService {
  private readonly logger = new Logger(FeedSyncService.name);

  constructor(
    @Inject(GOOGLE_DB_TOKEN) private readonly handle: KyselyClient<GoogleDatabase>,
    private readonly auth: GoogleAuthService,
    @Inject(GOOGLE_RATIO_PRODUCTS) private readonly products: RatioProductsPort,
  ) {}

  /** Defer a single-product push past the webhook ack (fire-and-forget). */
  enqueuePush(merchantId: string, product: RatioProduct, syncType: SyncType = 'webhook'): void {
    queueMicrotask(() => {
      this.syncProduct(merchantId, product, syncType).catch((err) =>
        this.logger.error({ msg: 'deferred product push failed', merchantId, err: `${err}` }),
      );
    });
  }

  /** Defer a delete past the webhook ack. */
  enqueueDelete(merchantId: string, productId: string): void {
    queueMicrotask(() => {
      this.deleteProduct(merchantId, productId).catch((err) =>
        this.logger.error({ msg: 'deferred product delete failed', merchantId, err: `${err}` }),
      );
    });
  }

  /** Map + push one product's variants; records per-offer feed status. */
  async syncProduct(
    merchantId: string,
    product: RatioProduct,
    syncType: SyncType = 'webhook',
  ): Promise<{ updated: number; errored: number }> {
    const ctx = await this.context(merchantId);
    if (!ctx) return { updated: 0, errored: 0 };
    const offers = mapProduct(product, ctx.mapperConfig);
    let updated = 0;
    let errored = 0;

    for (const offer of offers) {
      if (offer.status === 'ERROR' || !offer.gmc) {
        await this.writeFeedItem(merchantId, offer);
        errored += 1;
        continue;
      }
      try {
        await ctx.client.insertProduct(offer.gmc as unknown as Record<string, unknown>);
        await this.writeFeedItem(merchantId, offer, true);
        updated += 1;
      } catch (err) {
        const issue = err instanceof ContentApiError ? err.message : `${err}`;
        await this.writeFeedItem(merchantId, { ...offer, status: 'ERROR', issue });
        errored += 1;
      }
    }
    await this.writeSyncLog(merchantId, syncType, offers.length, updated, errored);
    return { updated, errored };
  }

  /** Delete every offer (variant) of a product from GMC and mark DELETED. */
  async deleteProduct(merchantId: string, productId: string): Promise<void> {
    const ctx = await this.context(merchantId);
    if (!ctx) return;
    const items = await this.handle.db
      .selectFrom('google_feed_items')
      .select(['offerId'])
      .where('merchantId', '=', merchantId)
      .where('productId', '=', productId)
      .execute();
    for (const { offerId } of items) {
      try {
        await ctx.client.deleteProduct(ctx.restId(offerId));
      } catch (err) {
        this.logger.warn({ msg: 'gmc delete failed', merchantId, offerId, err: `${err}` });
      }
    }
    await this.handle.db
      .updateTable('google_feed_items')
      .set({ status: 'DELETED', updatedAt: sql`CURRENT_TIMESTAMP(3)` } as never)
      .where('merchantId', '=', merchantId)
      .where('productId', '=', productId)
      .execute();
    await this.writeSyncLog(merchantId, 'webhook', items.length, 0, 0);
  }

  /** Full-catalog batch sync (on connect / Force Sync). Chunks of 1000. */
  async fullSync(merchantId: string, syncType: SyncType): Promise<{ updated: number; errored: number }> {
    const ctx = await this.context(merchantId);
    if (!ctx) return { updated: 0, errored: 0 };
    const catalog = await this.products.listAll(merchantId);
    const offers = catalog.flatMap((p) => mapProduct(p, ctx.mapperConfig));
    const syncable = offers.filter((o) => o.status !== 'ERROR' && o.gmc);
    let updated = 0;
    let errored = offers.length - syncable.length;

    for (const offer of offers.filter((o) => o.status === 'ERROR' || !o.gmc)) {
      await this.writeFeedItem(merchantId, offer);
    }

    for (const batch of ContentApiClient.chunk(syncable, 1000)) {
      const entries: BatchEntry[] = batch.map((offer, i) => ({
        batchId: i,
        merchantId: ctx.gmcMerchantId,
        method: 'insert',
        product: offer.gmc as unknown as Record<string, unknown>,
      }));
      try {
        const res = await ctx.client.custombatch(entries);
        const failed = new Set((res.entries ?? []).filter((e) => e.errors).map((e) => e.batchId));
        for (let i = 0; i < batch.length; i++) {
          const offer = batch[i];
          if (!offer) continue;
          if (failed.has(i)) {
            await this.writeFeedItem(merchantId, { ...offer, status: 'ERROR', issue: 'GMC batch rejected' });
            errored += 1;
          } else {
            await this.writeFeedItem(merchantId, offer, true);
            updated += 1;
          }
        }
      } catch (err) {
        this.logger.error({ msg: 'custombatch failed', merchantId, err: `${err}` });
        errored += batch.length;
      }
    }
    await this.writeSyncLog(merchantId, syncType, offers.length, updated, errored);
    return { updated, errored };
  }

  initialSync(merchantId: string): Promise<{ updated: number; errored: number }> {
    return this.fullSync(merchantId, 'initial');
  }

  forceSync(merchantId: string): Promise<{ updated: number; errored: number }> {
    return this.fullSync(merchantId, 'manual');
  }

  /** Resolve the per-merchant GMC client + mapper config, or null if GMC is off. */
  private async context(merchantId: string): Promise<{
    client: ContentApiClient;
    gmcMerchantId: string;
    mapperConfig: Parameters<typeof mapProduct>[1];
    restId: (offerId: string) => string;
  } | null> {
    const config = await this.handle.db
      .selectFrom('google_configs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (!config || !config.gmcEnabled || !config.gmcMerchantId) return null;

    const merchant = await this.handle.db
      .selectFrom('merchants')
      .select(['id'])
      .where('id', '=', merchantId)
      .executeTakeFirst();
    const storeDomain = `${merchant?.id ?? merchantId}.example-store.com`;

    const client = new ContentApiClient({
      merchantId: config.gmcMerchantId,
      getAccessToken: () => this.auth.getGmcAccessToken(merchantId),
    });
    return {
      client,
      gmcMerchantId: config.gmcMerchantId,
      mapperConfig: {
        storeDomain,
        storePrefix: merchantId,
        targetCountry: config.gmcTargetCountry,
        contentLanguage: config.gmcContentLanguage,
        currency: config.gmcCurrency,
        defaultCondition: config.gmcDefaultCondition,
        brandOverride: config.gmcBrandOverride,
        googleProductCategory: config.gmcGoogleProductCategory,
      },
      restId: (offerId: string) =>
        `online:${config.gmcContentLanguage}:${config.gmcTargetCountry}:${offerId}`,
    };
  }

  private async writeFeedItem(
    merchantId: string,
    offer: MappedOffer,
    synced = false,
  ): Promise<void> {
    // `offer.status` already carries the right state (SYNCED/WARNING from the
    // mapper, or ERROR set by the caller on a failed push).
    const status = offer.status;
    await this.handle.db
      .insertInto('google_feed_items')
      .values({
        merchantId,
        offerId: offer.offerId,
        productId: offer.productId,
        variantId: offer.variantId,
        title: offer.title.slice(0, 255),
        status,
        hasGtin: offer.hasGtin,
        issue: offer.issue,
        lastSyncedAt: synced ? sql`CURRENT_TIMESTAMP(3)` : null,
      } as never)
      .onDuplicateKeyUpdate({
        productId: offer.productId,
        variantId: offer.variantId,
        title: offer.title.slice(0, 255),
        status,
        hasGtin: offer.hasGtin,
        issue: offer.issue,
        ...(synced ? { lastSyncedAt: sql`CURRENT_TIMESTAMP(3)` } : {}),
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .execute();
  }

  private async writeSyncLog(
    merchantId: string,
    syncType: SyncType,
    checked: number,
    updated: number,
    errored: number,
  ): Promise<void> {
    await this.handle.db
      .insertInto('google_sync_log')
      .values({
        merchantId,
        syncType,
        productsChecked: checked,
        productsUpdated: updated,
        productsErrored: errored,
        detail: `${updated} updated, ${errored} errors`,
      } as never)
      .execute();
  }
}
