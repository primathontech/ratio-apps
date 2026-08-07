import type { Kysely } from 'kysely';

/**
 * 0002 — Unique idempotency backstop on `uc_sync_jobs`, promised by the TRD
 * (line 337: `UNIQUE (merchant_id, ratio_order_id, type)`) but never actually
 * created by 0001. Without it, two independent writers (the `orders/create`
 * webhook handler and the reconciliation sweep, or two overlapping sweep
 * runs) can both insert an `order_push`/`cancel_push` row for the same
 * order, and both get pushed to Unicommerce — a real, confirmed duplicate-
 * push bug found via a 2026-08-06 audit. Same pattern as 0007's
 * `idx_uc_order_item_map_lookup` unique index: turns a lost check-then-
 * insert race into a rejected duplicate INSERT that callers catch and
 * recover from (see `UcOrderItemMapService.generate()`'s existing
 * `isDuplicateKeyError` handling for the precedent).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createIndex('idx_uc_sync_jobs_lookup')
    .on('uc_sync_jobs')
    .columns(['merchant_id', 'ratio_order_id', 'type'])
    .unique()
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_uc_sync_jobs_lookup').on('uc_sync_jobs').execute();
}
