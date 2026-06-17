/**
 * 0005 — CAPI delivery stats (per-merchant, per-day rollup).
 *
 * Events themselves are NEVER stored (1M+/day/merchant) — they flow
 * ingest → queue → worker → Meta and are gone after the ack. This table is a
 * COUNTER rollup: the worker bumps one row per merchant per UTC day on each
 * flush (INSERT … ON DUPLICATE KEY UPDATE col = col + n). So a merchant doing
 * 1M events/day produces ONE row/day, not 1M rows — ~365 rows/merchant/year.
 *
 * Columns:
 *  - batches    — number of flush attempts that succeeded
 *  - dispatched — events successfully delivered to Meta
 *  - failed     — events in flush attempts that errored. These are RETRIED
 *                 (see MetaCapiWorker), so `failed` is a health/error signal,
 *                 NOT a data-loss count. True loss = DLQ (future `dead_lettered`).
 *
 * Success rate is DERIVED at read time (dispatched / (dispatched + failed)) —
 * never stored, so it can't go stale.
 *
 * Additive only — safe to roll forward on live DBs.
 */

import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('meta_capi_stats')
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    // UTC calendar day (YYYY-MM-DD). DATE keeps the PK compact and the
    // timeline query a simple range scan.
    .addColumn('day', 'date', (c) => c.notNull())
    .addColumn('batches', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('dispatched', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('failed', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addPrimaryKeyConstraint('pk_meta_capi_stats', ['merchant_id', 'day'])
    .addForeignKeyConstraint(
      'fk_meta_capi_stats_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  // Failure breakdown by reason — answers "why did events fail?" in analytics.
  // `reason` is a BOUNDED classification code (rate_limited, invalid_request,
  // auth, timeout, server_error, unknown) — NOT the raw Meta message — so
  // cardinality is merchant × day × ~6, never high. `last_message` keeps one
  // example of the real error for debugging.
  await db.schema
    .createTable('meta_capi_failures')
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('day', 'date', (c) => c.notNull())
    .addColumn('reason', 'varchar(32)', (c) => c.notNull())
    .addColumn('events', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('last_message', 'varchar(512)', (c) => c.notNull().defaultTo(''))
    .addColumn('last_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addPrimaryKeyConstraint('pk_meta_capi_failures', ['merchant_id', 'day', 'reason'])
    .addForeignKeyConstraint(
      'fk_meta_capi_failures_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('meta_capi_failures').ifExists().execute();
  await db.schema.dropTable('meta_capi_stats').ifExists().execute();
}
