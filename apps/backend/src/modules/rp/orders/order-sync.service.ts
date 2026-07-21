import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoClient, type Db } from 'mongodb';
import type { Env } from '../../../config/env.schema';
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

  constructor(private readonly config: ConfigService<Env, true>) {}

  async upsertOrder(rawOrder: Record<string, unknown>, storeDomain: string): Promise<void> {
    const db = await this.getDb();
    if (!db) return;

    const normalized = normalizeOrder({ ...rawOrder, store: storeDomain });
    const numericId = normalized.id as number;

    if (!numericId) {
      this.logger.warn({ storeDomain }, 'order has no numeric id after normalization — skipping');
      return;
    }

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

  /**
   * Get or establish connection to RP MongoDB.
   * Used by order sync and products service to look up orders/line items.
   */
  async getDb(): Promise<Db | null> {
    if (this.db) return this.db;

    const url = (this.config.get as (key: string) => string | undefined)('RP_MONGO_URL');
    if (!url) {
      this.logger.warn('RP_MONGO_URL not set — order sync disabled');
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
