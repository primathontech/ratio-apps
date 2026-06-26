import { Inject, Injectable, Logger } from '@nestjs/common';
import type { FeedItemStatus } from '@ratio-app/shared/schemas/google-config';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { GoogleDatabase } from '../db/types';
import { GoogleAuthService } from '../google-oauth/google-auth.service';
import { GOOGLE_DB_TOKEN } from '../kysely.module';
import { GOOGLE_RATIO_PRODUCTS } from '../tokens';
import { type BatchEntry, ContentApiClient, ContentApiError } from './content-api.client';
import { type MappedOffer, mapProduct, type RatioProduct } from './product-mapper';

/** Seam over "read this merchant's full Ratio product catalog". */
export interface RatioProductsPort {
  listAll(merchantId: string): Promise<RatioProduct[]>;
  /** Fetch the authoritative raw product by id, or null if it 404s (gone). */
  getById(merchantId: string, productId: string): Promise<Record<string, unknown> | null>;
}

type SyncType = 'webhook' | 'auto' | 'reconcile' | 'initial' | 'manual';

/**
 * A feed-item status change worth recording in the append-only event log: any
 * time the new status differs from the stored one. A null/undefined prior status
 * means the offer was never seen before — that first observation is logged too.
 * Steady-state re-syncs (status unchanged) return false, so the log isn't spammed.
 */
export function isFeedStatusTransition(
  previous: FeedItemStatus | null | undefined,
  next: FeedItemStatus,
): boolean {
  return (previous ?? null) !== next;
}

/**
 * Normalize a configured storefront value into the bare host the mapper needs
 * for `https://<host>/products/<handle>`. Accepts a full URL or a bare host,
 * strips scheme / path / trailing dots-or-slashes. Returns null when empty.
 */
function normalizeStoreDomain(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return null;
  const noScheme = trimmed.replace(/^[a-z]+:\/\//i, '');
  const host = noScheme.split('/')[0] ?? noScheme;
  const cleaned = host.replace(/[/.]+$/, '').trim();
  return cleaned === '' ? null : cleaned;
}

/**
 * Whether a GMC push failure is worth retrying. Transient failures (rate-limit,
 * 5xx, or a non-HTTP error like a network/timeout) should redeliver via the
 * SQS visibility timeout; permanent failures (4xx validation — bad field,
 * rejected value) must NOT, or the message loops to the DLQ pointlessly.
 */
function isTransientGmcError(err: unknown): boolean {
  if (err instanceof ContentApiError) {
    return err.status === 429 || err.status >= 500;
  }
  // Network error, timeout, or anything that never reached an HTTP status.
  return true;
}

/**
 * Pushes the Ratio catalog to Google Merchant Center via the Content API and
 * keeps `google_feed_items` / `google_sync_log` in step.
 *
 * Per-product webhook work is enqueued on a durable SQS queue by the webhook
 * handlers and drained by a separate worker that calls {@link syncProduct} /
 * {@link deleteProduct}. Bulk paths ({@link initialSync}, {@link forceSync})
 * batch via `products.custombatch` in chunks of 1000.
 */
@Injectable()
export class FeedSyncService {
  private readonly logger = new Logger(FeedSyncService.name);
  /** Merchants whose full sync is currently running (in-flight dedup). */
  private readonly running = new Set<string>();

  constructor(
    @Inject(GOOGLE_DB_TOKEN) private readonly handle: KyselyClient<GoogleDatabase>,
    private readonly auth: GoogleAuthService,
    @Inject(GOOGLE_RATIO_PRODUCTS) private readonly products: RatioProductsPort,
  ) {}

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
        await this.writeFeedItem(merchantId, offer, { syncType });
        errored += 1;
        continue;
      }
      try {
        await ctx.client.insertProduct(offer.gmc as unknown as Record<string, unknown>);
        await this.writeFeedItem(merchantId, offer, { synced: true, syncType });
        updated += 1;
      } catch (err) {
        // Transient (rate-limit / 5xx / network): rethrow so the worker leaves
        // the SQS message un-acked → it redelivers after the visibility timeout
        // and lands in the DLQ only after maxReceiveCount. We do NOT record a
        // permanent ERROR here — a retry may succeed.
        if (isTransientGmcError(err)) {
          this.logger.warn({
            msg: 'GMC transient error — leaving message for redrive',
            merchantId,
            offerId: offer.offerId,
            err: `${err}`,
          });
          throw err;
        }
        // Permanent (4xx validation): record ERROR and move on — retrying the
        // same payload would just fail again. Reconcile / a data fix heals it.
        const issue = err instanceof ContentApiError ? err.message : `${err}`;
        await this.writeFeedItem(merchantId, { ...offer, status: 'ERROR', issue }, { syncType });
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
      .select(['offerId', 'productId', 'variantId', 'title', 'status'])
      .where('merchantId', '=', merchantId)
      .where('productId', '=', productId)
      .execute();
    // Never synced → nothing to remove from GMC and no history to record. Return
    // before any GMC call / sync-log write so an unpublished-but-never-synced
    // product produces no log noise.
    if (items.length === 0) return;
    for (const { offerId } of items) {
      try {
        await ctx.client.deleteProduct(ctx.restId(offerId));
      } catch (err) {
        // Already gone (404/410) → the delete's goal is met; treat as success.
        if (err instanceof ContentApiError && (err.status === 404 || err.status === 410)) {
          continue;
        }
        // Transient → rethrow so the worker redelivers the delete (don't ack a
        // product that's still live in GMC). Permanent 4xx → log and move on.
        if (isTransientGmcError(err)) {
          this.logger.warn({
            msg: 'GMC delete transient error — leaving message for redrive',
            merchantId,
            offerId,
            err: `${err}`,
          });
          throw err;
        }
        this.logger.warn({ msg: 'gmc delete failed', merchantId, offerId, err: `${err}` });
      }
    }
    await this.handle.db
      .updateTable('google_feed_items')
      .set({ status: 'DELETED', issue: null, updatedAt: sql`CURRENT_TIMESTAMP(3)` } as never)
      .where('merchantId', '=', merchantId)
      .where('productId', '=', productId)
      .execute();
    // Preserve each offer's removal in the audit log (skip offers already DELETED).
    for (const it of items) {
      if (isFeedStatusTransition(it.status, 'DELETED')) {
        await this.recordFeedEvent(
          merchantId,
          {
            offerId: it.offerId,
            productId: it.productId,
            variantId: it.variantId,
            title: it.title,
            issue: null,
          },
          'DELETED',
          it.status,
          'webhook',
        );
      }
    }
    await this.writeSyncLog(merchantId, 'webhook', items.length, 0, 0);
  }

  /** Full-catalog batch sync (on connect / Force Sync). Chunks of 1000. */
  async fullSync(
    merchantId: string,
    syncType: SyncType,
  ): Promise<{ updated: number; errored: number }> {
    // Mark this merchant's sync in-flight for the whole run (also covers the
    // reconcile / initial paths) and clear it in the finally. The HTTP entry
    // point reserves synchronously via startForceSyncInBackground, so duplicate
    // requests are rejected before this even runs.
    this.running.add(merchantId);
    try {
      const ctx = await this.context(merchantId);
      if (!ctx) {
        // GMC disabled or no Merchant Center id — record WHY so the admin's sync
        // history shows a real reason instead of silently doing nothing.
        const detail = 'GMC not enabled or no Merchant Center ID configured';
        this.logger.warn({ msg: 'fullSync skipped', merchantId, detail });
        await this.writeSyncLog(merchantId, syncType, 0, 0, 0, detail);
        return { updated: 0, errored: 0 };
      }
      try {
        return await this.runFullSync(merchantId, syncType, ctx);
      } catch (err) {
        // Catalog fetch / GMC batch threw (e.g. Ratio products API error). Surface
        // it: log it AND persist a failed sync-log row so the admin sees the cause
        // rather than a fire-and-forget no-op.
        const detail = err instanceof Error ? err.message : `${err}`;
        this.logger.error({ msg: 'fullSync failed', merchantId, syncType, detail });
        await this.writeSyncLog(merchantId, syncType, 0, 0, 0, `sync failed: ${detail}`);
        throw err;
      }
    } finally {
      this.running.delete(merchantId);
    }
  }

  private async runFullSync(
    merchantId: string,
    syncType: SyncType,
    ctx: NonNullable<Awaited<ReturnType<FeedSyncService['context']>>>,
  ): Promise<{ updated: number; errored: number }> {
    const catalog = await this.products.listAll(merchantId);
    const offers = catalog.flatMap((p) => mapProduct(p, ctx.mapperConfig));
    const syncable = offers.filter((o) => o.status !== 'ERROR' && o.gmc);
    let updated = 0;
    let errored = offers.length - syncable.length;

    for (const offer of offers.filter((o) => o.status === 'ERROR' || !o.gmc)) {
      await this.writeFeedItem(merchantId, offer, { syncType });
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
            await this.writeFeedItem(
              merchantId,
              { ...offer, status: 'ERROR', issue: 'GMC batch rejected' },
              { syncType },
            );
            errored += 1;
          } else {
            await this.writeFeedItem(merchantId, offer, { synced: true, syncType });
            updated += 1;
          }
        }
      } catch (err) {
        this.logger.error({ msg: 'custombatch failed', merchantId, err: `${err}` });
        errored += batch.length;
      }
    }
    await this.writeSyncLog(merchantId, syncType, offers.length, updated, errored);
    // Completion visibility: a successful GMC push is otherwise silent, so log
    // the outcome (products fetched → offers → pushed/errored) for every sync.
    this.logger.log({
      msg: 'fullSync complete',
      merchantId,
      syncType,
      products: catalog.length,
      offers: offers.length,
      syncable: syncable.length,
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

  /** True iff a full sync is currently running for this merchant. */
  isSyncRunning(merchantId: string): boolean {
    return this.running.has(merchantId);
  }

  /**
   * Fire a Force Sync in the background, deduped per merchant. Returns `false`
   * (and starts nothing) when a sync is already running. The reservation
   * (`running.add`) happens synchronously here — BEFORE fullSync's first await —
   * so two back-to-back requests can't both pass the check and spawn
   * overlapping syncs (which pile up, exhaust the DB pool / upstream, and
   * surface as intermittent 500s on later requests).
   */
  startForceSyncInBackground(merchantId: string): boolean {
    if (this.running.has(merchantId)) {
      this.logger.warn({
        msg: 'feed sync already in progress — ignoring duplicate request',
        merchantId,
      });
      return false;
    }
    this.running.add(merchantId);
    void this.fullSync(merchantId, 'manual').catch(() => undefined);
    return true;
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

    // Product `link`s must live on the merchant's GMC-verified storefront
    // domain, else Google reports "Mismatched online store URL — Prevents from
    // showing". Resolve it from the per-merchant config, then a deployment-wide
    // env default, then a non-routable placeholder (last resort: the sync still
    // records SYNCED, but GMC will flag the URL mismatch until a real domain is
    // configured).
    const storeDomain =
      normalizeStoreDomain(config.gmcStoreUrl) ??
      normalizeStoreDomain(process.env.GMC_STORE_URL) ??
      `${merchantId}.example-store.com`;

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
    opts: { synced?: boolean; syncType: SyncType },
  ): Promise<void> {
    // `offer.status` already carries the right state (SYNCED/WARNING from the
    // mapper, or ERROR set by the caller on a failed push).
    const status = offer.status;

    // Read the current status BEFORE the upsert so we can tell whether this is a
    // real transition. google_feed_items keeps only the current row per offer;
    // the append-only google_feed_events log preserves the history.
    const prior = await this.handle.db
      .selectFrom('google_feed_items')
      .select('status')
      .where('merchantId', '=', merchantId)
      .where('offerId', '=', offer.offerId)
      .executeTakeFirst();
    const previousStatus = prior?.status ?? null;

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
        lastSyncedAt: opts.synced ? sql`CURRENT_TIMESTAMP(3)` : null,
      } as never)
      .onDuplicateKeyUpdate({
        productId: offer.productId,
        variantId: offer.variantId,
        title: offer.title.slice(0, 255),
        status,
        hasGtin: offer.hasGtin,
        issue: offer.issue,
        ...(opts.synced ? { lastSyncedAt: sql`CURRENT_TIMESTAMP(3)` } : {}),
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .execute();

    if (isFeedStatusTransition(previousStatus, status)) {
      await this.recordFeedEvent(merchantId, offer, status, previousStatus, opts.syncType);
    }
  }

  /**
   * Append one row to the audit log (never overwrites).
   *
   * The audit log is best-effort: a failure here must NEVER break the sync or
   * the feed-item write (which has already committed by the time we get here).
   * Crucially, swallowing the throw also stops the silent data loss it used to
   * cause — when the event insert threw, the caller's error handling treated the
   * whole product as failed and (for webhooks) redelivered the message; the
   * retry then saw the item already at its new status, detected no transition,
   * and acked without ever recording the event. So the throw didn't just fail
   * to log — it guaranteed the transition was lost. We log the failure loudly
   * instead, mirroring the Meta side's logWebhookDelivery.
   */
  private async recordFeedEvent(
    merchantId: string,
    offer: {
      offerId: string;
      productId: string;
      variantId: string | null;
      title: string | null;
      issue: string | null;
    },
    status: FeedItemStatus,
    previousStatus: FeedItemStatus | null,
    syncType: SyncType,
  ): Promise<void> {
    try {
      await this.handle.db
        .insertInto('google_feed_events')
        .values({
          merchantId,
          offerId: offer.offerId,
          productId: offer.productId,
          variantId: offer.variantId,
          title: offer.title?.slice(0, 255) ?? null,
          status,
          previousStatus,
          issue: offer.issue ?? null,
          syncType,
        } as never)
        .execute();
    } catch (err) {
      this.logger.error({
        msg: 'failed to write feed status-change event (audit log only — sync unaffected)',
        merchantId,
        offerId: offer.offerId,
        previousStatus,
        status,
        err: `${err}`,
      });
    }
  }

  private async writeSyncLog(
    merchantId: string,
    syncType: SyncType,
    checked: number,
    updated: number,
    errored: number,
    detail?: string,
  ): Promise<void> {
    await this.handle.db
      .insertInto('google_sync_log')
      .values({
        merchantId,
        syncType,
        productsChecked: checked,
        productsUpdated: updated,
        productsErrored: errored,
        detail: detail ?? `${updated} updated, ${errored} errors`,
      } as never)
      .execute();
  }
}
