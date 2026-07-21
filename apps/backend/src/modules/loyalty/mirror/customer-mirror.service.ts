import { Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import type { CoreBalanceResponse } from '../core-client/core-loyalty.client';
import type { LoyaltyCustomerRow, LoyaltyDatabase } from '../db/types';

/**
 * Any Kysely executor over the loyalty DB — either the module handle's `db`
 * or an open `Transaction<LoyaltyDatabase>` (transactions extend `Kysely`).
 * Webhook paths MUST pass the dispatch transaction so mirror writes roll back
 * atomically with the `webhook_log` row.
 */
export type LoyaltyExecutor = Kysely<LoyaltyDatabase>;

export interface OrderMirrorInput {
  phone: string;
  name?: string | null;
  email?: string | null;
  orderTotal: number;
  orderAt: Date;
}

type FirstSeenSource = LoyaltyCustomerRow['firstSeenSource'];

/**
 * `loyalty_customers` mirror writes. Every method takes the executor
 * explicitly (no injected DB) — counter updates are pure SQL arithmetic
 * (`x = x + …`, `GREATEST(0, …)`), never read-modify-write, so concurrent
 * webhooks/workers can't lose updates.
 *
 * Raw `sql` fragments reference snake_case column names — the CamelCasePlugin
 * does not rewrite raw SQL.
 */
@Injectable()
export class CustomerMirrorService {
  /**
   * Order-driven upsert: a new phone becomes a mirror row seeded from the
   * order (firstSeenSource 'order'); an existing row accumulates spend/orders
   * and keeps the greatest lastOrderAt. Non-null name/email never get
   * overwritten by null (COALESCE keeps the existing value).
   */
  async upsertFromOrder(
    exec: LoyaltyExecutor,
    merchantId: string,
    input: OrderMirrorInput,
  ): Promise<void> {
    await exec
      .insertInto('loyalty_customers')
      .values({
        merchantId,
        phone: input.phone,
        name: input.name ?? null,
        email: input.email ?? null,
        firstSeenSource: 'order',
        lifetimeSpend: input.orderTotal,
        lifetimeOrders: 1,
        lastOrderAt: input.orderAt,
      })
      .onDuplicateKeyUpdate({
        name: sql<string | null>`COALESCE(VALUES(name), name)`,
        email: sql<string | null>`COALESCE(VALUES(email), email)`,
        lifetimeSpend: sql<string>`lifetime_spend + VALUES(lifetime_spend)`,
        lifetimeOrders: sql<number>`lifetime_orders + 1`,
        lastOrderAt: sql<Date>`GREATEST(COALESCE(last_order_at, VALUES(last_order_at)), VALUES(last_order_at))`,
        updatedAt: sql<Date>`CURRENT_TIMESTAMP(3)`,
      })
      .execute();
  }

  /**
   * Insert-if-absent (INSERT IGNORE) so QR claims / bulk ops can flag brand
   * new-to-loyalty phones. Returns whether this call created the row.
   */
  async ensurePhone(
    exec: LoyaltyExecutor,
    merchantId: string,
    phone: string,
    source: FirstSeenSource,
  ): Promise<{ isNew: boolean }> {
    const res = await exec
      .insertInto('loyalty_customers')
      .ignore()
      .values({ merchantId, phone, firstSeenSource: source })
      .executeTakeFirst();
    return { isNew: Number(res.numInsertedOrUpdatedRows ?? 0) > 0 };
  }

  /** Refresh the cached Core balance columns from a live balance response. */
  async applyCoreBalance(
    exec: LoyaltyExecutor,
    merchantId: string,
    phone: string,
    coreBalance: CoreBalanceResponse,
  ): Promise<void> {
    await exec
      .updateTable('loyalty_customers')
      .set({
        pointsBalance: coreBalance.points_balance,
        lifetimeEarned: coreBalance.points_earned_lifetime,
        lifetimeRedeemed: coreBalance.points_redeemed_lifetime,
        lifetimeExpired: coreBalance.points_expired_lifetime,
        lifetimeAdjusted: coreBalance.points_adjusted_lifetime,
        balanceSyncedAt: new Date(),
        updatedAt: sql<Date>`CURRENT_TIMESTAMP(3)`,
      })
      .where('merchantId', '=', merchantId)
      .where('phone', '=', phone)
      .execute();
  }

  /**
   * `orders/cancelled` correction: spend/orders decrement, floored at 0 —
   * an unknown phone simply matches zero rows (safe no-op).
   */
  async decrementForCancelledOrder(
    exec: LoyaltyExecutor,
    merchantId: string,
    phone: string,
    orderTotal: number,
  ): Promise<void> {
    await exec
      .updateTable('loyalty_customers')
      .set({
        lifetimeSpend: sql<string>`GREATEST(0, lifetime_spend - ${orderTotal})`,
        lifetimeOrders: sql<number>`GREATEST(0, lifetime_orders - 1)`,
        updatedAt: sql<Date>`CURRENT_TIMESTAMP(3)`,
      })
      .where('merchantId', '=', merchantId)
      .where('phone', '=', phone)
      .execute();
  }
}
