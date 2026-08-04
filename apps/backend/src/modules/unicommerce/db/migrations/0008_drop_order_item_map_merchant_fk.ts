/**
 * 0008 — Drop the merchants FK from uc_order_item_map.
 *
 * Reproduced live via full end-to-end testing (real MySQL, real HTTP, not
 * mocked): every `orders/create` webhook delivery deadlocked and failed with
 * "Lock wait timeout exceeded; try restarting transaction" after exactly the
 * ~50s `innodb_lock_wait_timeout` default.
 *
 * Root cause: `WebhooksService.dispatch()` opens a transaction and takes
 * `SELECT ... FOR UPDATE` on the `merchants` row before invoking the handler.
 * `UcOrderConfirmedHandler.handle()` then calls `UcOrderItemMapService.
 * generate()`, which — BY DESIGN (see that service's doc) — writes via its
 * own module-level DB handle, a DIFFERENT pooled connection, so the row
 * survives even if the outer webhook trx later rolls back. But
 * `uc_order_item_map.merchant_id` carried a FK to `merchants(id)`, so that
 * INSERT (on connection B) needs a shared lock on the exact `merchants` row
 * connection A is holding exclusively — and connection A's transaction can't
 * commit/release it until `generate()` (running on connection B) returns.
 * Two connections from the same process, same row, circular wait: a genuine
 * deadlock, not just contention.
 *
 * Same fix and reasoning as google's 0004 (`fk_google_feed_events_merchant`):
 * the referenced merchant is already validated by the webhook dispatch's own
 * lookup before the handler ever runs, so the FK enforces nothing the app
 * layer doesn't already guarantee. `idx_uc_order_item_map_order` (0005) and
 * `idx_uc_order_item_map_lookup` (0007) are untouched — per-merchant reads
 * and the idempotency backstop both keep their indexes.
 *
 * Safe to roll forward on live DBs (drops a constraint only; no data change).
 */
import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE uc_order_item_map
      DROP FOREIGN KEY fk_uc_order_item_map_merchant
  `.execute(db);
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE uc_order_item_map
      ADD CONSTRAINT fk_uc_order_item_map_merchant
      FOREIGN KEY (merchant_id) REFERENCES merchants (id) ON DELETE CASCADE
  `.execute(db);
}
