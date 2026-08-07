import { sql, type Kysely } from 'kysely';

/**
 * 0003 — `uc_inbound_jobs`: the durable per-item queue behind the new
 * standalone `apps/uc-inbound-ingest` service (PART A of the additive
 * inbound-queue work).
 *
 * Rationale (see the TRD's inbound-queue section + the ingest app's own
 * README-level comments):
 *
 * - The two existing inbound endpoints (status.controller.ts,
 *   inventory.controller.ts) stay fully synchronous and unchanged — UC still
 *   calls THEM today. This table is written by the NEW standalone
 *   `uc-inbound-ingest` app (same `unicommerce_app` database, plain mysql2
 *   connection) as the durable PENDING record BEFORE it publishes to Kafka,
 *   so a publish failure never loses the work — exactly the same
 *   "DB row is durable, Kafka is fire-and-forget" contract
 *   `uc_sync_jobs` gives the outbound path.
 *
 * - One row PER ITEM (not per request), so retry/DLQ granularity matches the
 *   per-item granularity Unicommerce itself uses. `type` is
 *   'status_notify' | 'inventory_update' and the consumer branches on it.
 *
 * - `status` deliberately reuses the `uc_sync_jobs` vocabulary minus
 *   'CANCELLED' (nothing cancels an inbound job): PENDING | IN_PROGRESS |
 *   RETRYING | DONE | NEEDS_MANUAL.
 *
 * - `uc_dlq` (0001) is reused as-is for terminal failures — its schema is
 *   generic (merchant_id, original_job_id, payload, attempts, last_error) and
 *   nothing joins it back to `uc_sync_jobs`, so inbound job ids fit without
 *   any change.
 */
// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('uc_inbound_jobs')
    .addColumn('id', 'char(36)', (c) => c.notNull().primaryKey().defaultTo(sql`(UUID())`))
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('type', 'varchar(32)', (c) => c.notNull()) // 'status_notify' | 'inventory_update'
    .addColumn('payload', 'json', (c) => c.notNull())
    .addColumn('status', 'varchar(16)', (c) => c.notNull().defaultTo('PENDING')) // PENDING|IN_PROGRESS|RETRYING|DONE|NEEDS_MANUAL
    .addColumn('attempt_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('next_retry_at', 'datetime(3)')
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addForeignKeyConstraint('fk_uc_inbound_jobs_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  // Same retry-scan index as `idx_uc_sync_jobs_retry` on uc_sync_jobs (0001):
  // a future sweep that wants "due now" PENDING/RETRYING rows scans exactly
  // (status, next_retry_at).
  await db.schema
    .createIndex('idx_uc_inbound_jobs_retry')
    .on('uc_inbound_jobs')
    .columns(['status', 'next_retry_at'])
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_uc_inbound_jobs_retry').on('uc_inbound_jobs').execute();
  await db.schema.dropTable('uc_inbound_jobs').ifExists().execute();
}
