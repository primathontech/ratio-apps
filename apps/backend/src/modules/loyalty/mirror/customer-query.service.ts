import { Inject, Injectable } from '@nestjs/common';
import type {
  LoyaltyCustomerFilter,
  LoyaltyCustomerFilters,
} from '@ratio-app/shared/schemas/loyalty-export';
import type { SelectQueryBuilder } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { LoyaltyCustomerRow, LoyaltyDatabase } from '../db/types';
import { LOYALTY_DB_TOKEN } from '../kysely.module';
import type { CustomerQuery, LoyaltyCustomerSort } from './customer-query.types';

/**
 * The single Kysely implementation of the {@link CustomerQuery} contract —
 * powers the admin customers list, the export preview/worker, and the
 * leaderboard. Filters are AND-joined (PRD §4.4); `in_rule` / `scanned_qr`
 * become correlated EXISTS subqueries so no join fan-out can duplicate rows.
 */

type CustomersQB = SelectQueryBuilder<LoyaltyDatabase, 'loyalty_customers', object>;

const NUMERIC_COLUMNS = {
  points_balance: 'pointsBalance',
  lifetime_earned: 'lifetimeEarned',
  lifetime_redeemed: 'lifetimeRedeemed',
  lifetime_spend: 'lifetimeSpend',
  lifetime_orders: 'lifetimeOrders',
} as const;

const NUMERIC_OPS = {
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  eq: '=',
} as const;

const SORT_COLUMNS: Record<LoyaltyCustomerSort, keyof LoyaltyCustomerRow> = {
  points_balance: 'pointsBalance',
  lifetime_earned: 'lifetimeEarned',
  lifetime_spend: 'lifetimeSpend',
  lifetime_orders: 'lifetimeOrders',
  last_order_at: 'lastOrderAt',
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/** streamAll keyset batch size — no OFFSET, so deep exports stay O(rows). */
const STREAM_BATCH = 1_000;

@Injectable()
export class CustomerQueryService implements CustomerQuery {
  constructor(@Inject(LOYALTY_DB_TOKEN) private readonly handle: KyselyClient<LoyaltyDatabase>) {}

  async count(merchantId: string, filters: LoyaltyCustomerFilters): Promise<number> {
    const row = await this.base(merchantId, filters)
      .select((eb) => eb.fn.countAll<number>().as('total'))
      .executeTakeFirst();
    return Number((row as { total?: unknown } | undefined)?.total ?? 0);
  }

  async page(
    merchantId: string,
    filters: LoyaltyCustomerFilters,
    opts: { page: number; limit: number; sort: LoyaltyCustomerSort },
  ): Promise<{ rows: LoyaltyCustomerRow[]; total: number }> {
    const limit = Math.min(Math.max(1, Math.floor(opts.limit) || DEFAULT_LIMIT), MAX_LIMIT);
    const page = Math.max(1, Math.floor(opts.page) || 1);
    const sortColumn = SORT_COLUMNS[opts.sort] ?? 'pointsBalance';

    const [rows, total] = await Promise.all([
      this.base(merchantId, filters)
        .selectAll()
        .orderBy(sortColumn as 'pointsBalance', 'desc')
        .limit(limit)
        .offset((page - 1) * limit)
        .execute() as Promise<LoyaltyCustomerRow[]>,
      this.count(merchantId, filters),
    ]);
    return { rows, total };
  }

  async *streamAll(
    merchantId: string,
    filters: LoyaltyCustomerFilters,
    maxRows: number,
  ): AsyncIterable<LoyaltyCustomerRow> {
    let lastPhone = '';
    let yielded = 0;
    while (yielded < maxRows) {
      const batch = (await this.base(merchantId, filters)
        .selectAll()
        .where('phone', '>', lastPhone)
        .orderBy('phone', 'asc')
        .limit(STREAM_BATCH)
        .execute()) as LoyaltyCustomerRow[];
      if (batch.length === 0) return;
      for (const row of batch) {
        if (yielded >= maxRows) return;
        yielded += 1;
        lastPhone = row.phone;
        yield row;
      }
      if (batch.length < STREAM_BATCH) return;
    }
  }

  /** Merchant scope + every filter, AND-joined. */
  private base(merchantId: string, filters: LoyaltyCustomerFilters): CustomersQB {
    let qb: CustomersQB = this.handle.db
      .selectFrom('loyalty_customers')
      .where('merchantId', '=', merchantId);
    for (const filter of filters) qb = this.applyFilter(qb, filter);
    return qb;
  }

  private applyFilter(qb: CustomersQB, filter: LoyaltyCustomerFilter): CustomersQB {
    if (filter.field === 'in_rule') {
      // EXISTS on the rule's customer list, correlated on phone.
      return qb.where(({ exists, selectFrom }) =>
        exists(
          selectFrom('loyalty_rule_customers')
            .select('loyalty_rule_customers.ruleId')
            .whereRef('loyalty_rule_customers.phone', '=', 'loyalty_customers.phone')
            .where('loyalty_rule_customers.ruleId', '=', filter.value),
        ),
      );
    }

    if (filter.field === 'scanned_qr') {
      // EXISTS on the QR's scans, correlated on phone + merchant.
      return qb.where(({ exists, selectFrom }) =>
        exists(
          selectFrom('loyalty_qr_scans')
            .select('loyalty_qr_scans.id')
            .whereRef('loyalty_qr_scans.phone', '=', 'loyalty_customers.phone')
            .whereRef('loyalty_qr_scans.merchantId', '=', 'loyalty_customers.merchantId')
            .where('loyalty_qr_scans.qrCodeId', '=', filter.value),
        ),
      );
    }

    if (filter.field === 'last_order_at') {
      if (filter.operator === 'between') {
        const [from, to] = filter.value as [string, string];
        return qb
          .where('lastOrderAt', '>=', new Date(from))
          .where('lastOrderAt', '<=', new Date(to));
      }
      const op = filter.operator === 'before' ? '<' : '>';
      return qb.where('lastOrderAt', op, new Date(filter.value as string));
    }

    const column = NUMERIC_COLUMNS[filter.field];
    if (filter.operator === 'between') {
      const [lo, hi] = filter.value as [number, number];
      return qb.where(column, '>=', lo as never).where(column, '<=', hi as never);
    }
    return qb.where(column, NUMERIC_OPS[filter.operator], filter.value as never);
  }
}
