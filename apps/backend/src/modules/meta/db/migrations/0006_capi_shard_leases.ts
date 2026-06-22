/**
 * 0006 — CAPI Kinesis shard lease / checkpoint table.
 *
 * Each row represents one Kinesis shard being consumed. The consumer holds a
 * lease (owner + leased_until) so that multiple workers don't double-process
 * the same shard. `checkpoint_seq` records the last successfully processed
 * sequence number so the consumer can resume after a restart without
 * reprocessing.
 *
 * Composite PK (stream, shard_id) — a shard belongs to exactly one stream.
 * Nullable owner/leased_until/checkpoint_seq — NULL means unclaimed / not yet
 * checkpointed. updated_at auto-refreshes on every write via ON UPDATE.
 */

import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS meta_capi_shard_leases (
      stream          VARCHAR(128) NOT NULL,
      shard_id        VARCHAR(128) NOT NULL,
      owner           VARCHAR(128) NULL,
      leased_until    DATETIME(3)  NULL,
      checkpoint_seq  VARCHAR(256) NULL,
      updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (stream, shard_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `.execute(db);
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS meta_capi_shard_leases`.execute(db);
}
