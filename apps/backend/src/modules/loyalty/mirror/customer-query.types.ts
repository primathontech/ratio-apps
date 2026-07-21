import type { LoyaltyCustomerFilters } from '@ratio-app/shared/schemas/loyalty-export';
import type { LoyaltyCustomerRow } from '../db/types';

/**
 * The customer-mirror query contract shared by the customers list/preview,
 * the export worker, and the leaderboard. Implemented by
 * `mirror/customer-query.service.ts`; consumers depend on this interface so
 * tests can inject in-memory fakes.
 */
export type LoyaltyCustomerSort =
  | 'points_balance'
  | 'lifetime_earned'
  | 'lifetime_spend'
  | 'lifetime_orders'
  | 'last_order_at';

export interface CustomerQuery {
  /** AND-joined filter count — powers the export preview + email threshold. */
  count(merchantId: string, filters: LoyaltyCustomerFilters): Promise<number>;

  /** One page of matching rows (default 20, max 100), sorted desc. */
  page(
    merchantId: string,
    filters: LoyaltyCustomerFilters,
    opts: { page: number; limit: number; sort: LoyaltyCustomerSort },
  ): Promise<{ rows: LoyaltyCustomerRow[]; total: number }>;

  /** Batched full iteration for export CSV generation (keyset, no OFFSET). */
  streamAll(
    merchantId: string,
    filters: LoyaltyCustomerFilters,
    maxRows: number,
  ): AsyncIterable<LoyaltyCustomerRow>;
}
