import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { UnicommerceDatabase } from '../db/types';
import { isDuplicateKeyError } from './duplicate-key.util';
import { UC_DB_TOKEN } from '../kysely.module';

export interface OrderItemMapping {
  merchantId: string;
  ratioOrderId: string;
  ratioLineItemId: string;
}

export interface OrderItemFull {
  orderItemId: string;
  merchantId: string;
  ratioOrderId: string;
  ratioLineItemId: string;
  orderedQuantity: number;
  remainingQuantity: number;
  lastStatus: string | null;
  lastStatusUpdatedAt: Date | null;
  saleOrderCode: string | null;
  source: 'ratio_originated' | 'uc_originated';
}

@Injectable()
export class UcOrderItemMapService {
  constructor(@Inject(UC_DB_TOKEN) private readonly handle: KyselyClient<UnicommerceDatabase>) {}

  async generate(
    merchantId: string,
    ratioOrderId: string,
    ratioLineItemId: string,
    quantity?: number,
    source?: 'ratio_originated' | 'uc_originated',
  ): Promise<string> {
    const existing = await this.lookup(merchantId, ratioOrderId, ratioLineItemId);
    if (existing) return existing;

    const orderItemId = randomBytes(16).toString('hex').slice(0, 40);
    try {
      await this.handle.db
        .insertInto('ucOrderItemMap')
        .values({
          orderItemId,
          merchantId,
          ratioOrderId,
          ratioLineItemId,
          orderedQuantity: quantity ?? 0,
          remainingQuantity: quantity ?? 0,
          source: source ?? 'ratio_originated',
        })
        .execute();
      return orderItemId;
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const winner = await this.lookup(merchantId, ratioOrderId, ratioLineItemId);
      if (!winner) throw err;
      return winner;
    }
  }

  private async lookup(
    merchantId: string,
    ratioOrderId: string,
    ratioLineItemId: string,
  ): Promise<string | null> {
    const row = await this.handle.db
      .selectFrom('ucOrderItemMap')
      .select('orderItemId')
      .where('merchantId', '=', merchantId)
      .where('ratioOrderId', '=', ratioOrderId)
      .where('ratioLineItemId', '=', ratioLineItemId)
      .executeTakeFirst();
    return row?.orderItemId ?? null;
  }

  async resolve(orderItemId: string): Promise<OrderItemMapping | null> {
    const row = await this.handle.db
      .selectFrom('ucOrderItemMap')
      .selectAll()
      .where('orderItemId', '=', orderItemId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      merchantId: row.merchantId,
      ratioOrderId: row.ratioOrderId,
      ratioLineItemId: row.ratioLineItemId,
    };
  }

  async resolveFull(orderItemId: string): Promise<OrderItemFull | null> {
    const row = await this.handle.db
      .selectFrom('ucOrderItemMap')
      .selectAll()
      .where('orderItemId', '=', orderItemId)
      .executeTakeFirst();
    if (!row) return null;
    return row;
  }

  async findSaleOrderCode(merchantId: string, ratioOrderId: string): Promise<string | null> {
    const row = await this.handle.db
      .selectFrom('ucSyncJobs')
      .select('saleOrderCode')
      .where('merchantId', '=', merchantId)
      .where('ratioOrderId', '=', ratioOrderId)
      .where('type', '=', 'order_push')
      .where('status', '=', 'DONE')
      .orderBy('createdAt', 'desc')
      .executeTakeFirst();
    return row?.saleOrderCode ?? null;
  }

  async decrementRemainingQuantity(orderItemId: string, quantity: number): Promise<void> {
    await this.handle.db
      .updateTable('ucOrderItemMap')
      .set({ remainingQuantity: sql`remaining_quantity - ${quantity}` })
      .where('orderItemId', '=', orderItemId)
      .where('remainingQuantity', '>=', quantity)
      .execute();
  }

  async updateLastStatus(orderItemId: string, status: string, updatedAt: string): Promise<void> {
    await this.handle.db
      .updateTable('ucOrderItemMap')
      .set({
        lastStatus: status,
        lastStatusUpdatedAt: new Date(updatedAt),
      })
      .where('orderItemId', '=', orderItemId)
      .execute();
  }

  // Tags which side originated a cancel — the loop-prevention marker for
  // the outbound cancel-push handler (TRD §5): a cancel that came FROM UC
  // must never re-fire an outbound cancel push back to UC. Set on the
  // specific items actually cancelled in a given call, never on survivors
  // of a partial cancel (they weren't cancelled and their true origin is
  // unaffected).
  async markSource(orderItemId: string, source: 'ratio_originated' | 'uc_originated'): Promise<void> {
    await this.handle.db
      .updateTable('ucOrderItemMap')
      .set({ source })
      .where('orderItemId', '=', orderItemId)
      .execute();
  }

  async updateSaleOrderCode(orderItemId: string, saleOrderCode: string): Promise<void> {
    await this.handle.db
      .updateTable('ucOrderItemMap')
      .set({ saleOrderCode })
      .where('orderItemId', '=', orderItemId)
      .execute();
  }

  async findByRatioOrder(merchantId: string, ratioOrderId: string): Promise<OrderItemFull[]> {
    const rows = await this.handle.db
      .selectFrom('ucOrderItemMap')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .where('ratioOrderId', '=', ratioOrderId)
      .execute();
    return rows;
  }
}
