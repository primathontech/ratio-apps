import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { UC_DB_TOKEN } from '../kysely.module';
import type { UnicommerceDatabase, UcSyncQueueRow } from '../db/types';

export const BACKOFF_INTERVALS_MINUTES = [1, 5, 15] as const;

export interface SyncQueueItem {
  id: string;
  merchantId: string;
  orderId: string;
  syncType: string;
  status: string;
  retryCount: number;
  lastError: string | null;
}

@Injectable()
export class UcSyncQueueService {
  private readonly logger = new Logger(UcSyncQueueService.name);

  constructor(
    @Inject(UC_DB_TOKEN) private readonly handle: KyselyClient<UnicommerceDatabase>,
  ) {}

  async enqueue(merchantId: string, orderId: string, syncType: string): Promise<void> {
    await this.handle.db
      .insertInto('uc_sync_queue')
      .values({
        id: randomUUID(),
        merchantId,
        orderId,
        syncType,
        status: 'pending',
        retryCount: 0,
        nextRetryAt: new Date(Date.now() + BACKOFF_INTERVALS_MINUTES[0] * 60 * 1000),
        lastError: null,
      })
      .execute();
    this.logger.log({ msg: 'enqueued sync item', merchantId, orderId, syncType });
  }

  async markFailed(id: string, error: string): Promise<number | null> {
    const row = await this.handle.db
      .selectFrom('uc_sync_queue')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return null;

    const nextRetryIndex = row.retryCount + 1;
    if (nextRetryIndex >= BACKOFF_INTERVALS_MINUTES.length) {
      await this.handle.db
        .updateTable('uc_sync_queue')
        .set({
          status: 'failed',
          lastError: error,
          updatedAt: sql`CURRENT_TIMESTAMP(3)`,
        })
        .where('id', '=', id)
        .execute();
      this.logger.warn({ msg: 'sync item exhausted retries', id, error });
      return null;
    }

    const intervalMin: number = BACKOFF_INTERVALS_MINUTES[nextRetryIndex] ?? 15;
    const nextRetryAt = new Date(Date.now() + intervalMin * 60 * 1000);
    await this.handle.db
      .updateTable('uc_sync_queue')
      .set({
        status: 'pending',
        retryCount: row.retryCount + 1,
        nextRetryAt,
        lastError: error,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where('id', '=', id)
      .execute();
    this.logger.log({ msg: 'sync item retry scheduled', id, retryAfter: nextRetryIndex });
    return nextRetryIndex;
  }

  async markSuccess(id: string): Promise<void> {
    await this.handle.db
      .updateTable('uc_sync_queue')
      .set({
        status: 'completed',
        lastError: null,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where('id', '=', id)
      .execute();
  }

  async getPendingItems(merchantId?: string): Promise<UcSyncQueueRow[]> {
    let query = this.handle.db
      .selectFrom('uc_sync_queue')
      .selectAll()
      .where('status', '=', 'pending')
      .where('nextRetryAt', '<=', new Date())
      .orderBy('retryCount', 'asc')
      .orderBy('createdAt', 'asc');
    if (merchantId) {
      query = query.where('merchantId', '=', merchantId);
    }
    return query.execute();
  }

  async getFailedItems(merchantId: string): Promise<UcSyncQueueRow[]> {
    return this.handle.db
      .selectFrom('uc_sync_queue')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .where('status', '=', 'failed')
      .orderBy('updatedAt', 'desc')
      .execute();
  }

  async getOrderStatus(merchantId: string, orderId: string): Promise<UcSyncQueueRow | null> {
    const row = await this.handle.db
      .selectFrom('uc_sync_queue')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .where('orderId', '=', orderId)
      .where('syncType', '=', 'order_push')
      .orderBy('createdAt', 'desc')
      .executeTakeFirst();
    return row ?? null;
  }

  async retry(id: string): Promise<void> {
    await this.handle.db
      .updateTable('uc_sync_queue')
      .set({
        status: 'pending',
        retryCount: 0,
        nextRetryAt: new Date(Date.now() + 60 * 1000),
        lastError: null,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where('id', '=', id)
      .execute();
  }
}
