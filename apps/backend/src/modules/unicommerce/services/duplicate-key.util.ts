/**
 * True when `err` is a MySQL duplicate-key rejection (`ER_DUP_ENTRY` /
 * errno 1062) from a unique index/constraint violation — the signal a
 * check-then-insert race lost to a concurrent writer, not a real failure.
 * Shared by every insert site that relies on a unique index as its
 * idempotency backstop (see `uc_order_item_map`'s lookup index and
 * `uc_sync_jobs`'s `(merchant_id, ratio_order_id, type)` index).
 */
export function isDuplicateKeyError(err: unknown): boolean {
  const e = err as { code?: string; errno?: number } | undefined;
  return e?.code === 'ER_DUP_ENTRY' || e?.errno === 1062;
}
