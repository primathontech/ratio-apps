import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoClient, type Db } from 'mongodb';
import type { Env } from '../../../config/env.schema';
import { RpIdMappingService } from '../id-mapping/id-mapping.service';
import { normalizeOrder } from './normalize-order';

/**
 * Syncs OS orders into RP's MongoDB `orders` collection.
 * Called by the order webhook handlers so RP has order data at return time
 * without needing to fetch on demand (reduces latency + decouples from OS API).
 *
 * IMPORTANT: RP's return/exchange flow reads the `Order` model, which maps to
 * the `orders` collection. Writing anywhere else (e.g. `shopifyorders`, which no
 * RP code reads) leaves orders invisible to validateOrder at return time.
 */
@Injectable()
export class RpOrderSyncService implements OnModuleDestroy {
  private readonly logger = new Logger(`RP:${RpOrderSyncService.name}`);
  private client: MongoClient | null = null;
  private db: Db | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly idMapping: RpIdMappingService,
  ) {}

  async upsertOrder(rawOrder: Record<string, unknown>, storeDomain: string): Promise<void> {
    const normalized = normalizeOrder({ ...rawOrder, store: storeDomain });
    const numericId = normalized.id as number;

    if (!numericId) {
      this.logger.warn({ storeDomain }, 'order has no numeric id after normalization — skipping');
      return;
    }

    // Runs regardless of whether RP_MONGO_URL is configured below: id-mapping is backed by
    // ratio-apps' own database (id-mapping module), not RP's Mongo, so it must not be gated
    // behind Mongo availability — that would defeat the point of not depending on RP's Mongo.
    await this.persistLineItemIdMappings(normalized);

    const db = await this.getDb();
    if (!db) return;

    try {
      await db.collection('orders').updateOne(
        { id: numericId, store: storeDomain },
        { $set: { ...normalized, store: storeDomain, updated_at: new Date() } },
        { upsert: true },
      );
      this.logger.log({ id: numericId, store: storeDomain }, 'order upserted into RP MongoDB');
    } catch (err) {
      this.logger.error({ err, id: numericId, store: storeDomain }, 'failed to upsert order');
    }
  }

  /** See RpOrdersService.persistLineItemIdMappings — same purpose, webhook-driven path. */
  private async persistLineItemIdMappings(order: Record<string, unknown>): Promise<void> {
    const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
    await Promise.all(
      lineItems.flatMap((li) => {
        const item = li as Record<string, unknown>;
        const writes: Promise<unknown>[] = [];
        if (item.os_product_id != null) {
          writes.push(this.idMapping.hashAndPersist('product', String(item.os_product_id)));
        }
        if (item.os_variant_id != null) {
          writes.push(this.idMapping.hashAndPersist('variant', String(item.os_variant_id)));
        }
        return writes;
      }),
    );
  }

  /**
   * Get or establish connection to RP MongoDB. Used only by order sync (caching order
   * documents for RP's own return-flow reads) — hashed-id resolution no longer depends on
   * this; see id-mapping module.
   */
  async getDb(): Promise<Db | null> {
    if (this.db) return this.db;

    const url = (this.config.get as (key: string) => string | undefined)('RP_MONGO_URL');
    if (!url) {
      this.logger.warn('RP_MONGO_URL not set — order sync into RP MongoDB disabled');
      return null;
    }

    try {
      this.client = new MongoClient(url);
      await this.client.connect();
      this.db = this.client.db();
      this.logger.log('connected to RP MongoDB');
      return this.db;
    } catch (err) {
      this.logger.error({ err }, 'failed to connect to RP MongoDB');
      this.client = null;
      this.db = null;
      return null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
  }
}
