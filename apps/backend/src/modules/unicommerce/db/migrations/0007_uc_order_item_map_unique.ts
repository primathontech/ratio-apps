import type { Kysely } from 'kysely';

/**
 * DB-level backstop against orphaned uc_order_item_map rows (review Fix 3):
 * `UcOrderItemMapService.generate()` now does a SELECT-then-INSERT to reuse
 * an existing row for the same (merchant_id, ratio_order_id,
 * ratio_line_item_id) tuple, but that check-then-act is racy under
 * concurrent calls. This unique index turns a lost race into a rejected
 * duplicate INSERT rather than a silent second row. The existing
 * `idx_uc_order_item_map_order` index (merchant_id, ratio_order_id) is left
 * in place — it serves order-level lookups (e.g. cancel/status flows) that
 * this narrower, line-item-scoped unique index doesn't cover.
 */
// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createIndex('idx_uc_order_item_map_lookup')
    .on('uc_order_item_map')
    .columns(['merchant_id', 'ratio_order_id', 'ratio_line_item_id'])
    .unique()
    .execute();
}
