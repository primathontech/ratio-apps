/**
 * D1 — drop `idx_webhook_log_unprocessed` from `webhook_log.processed_at`.
 *
 * The index was added in 0001_initial.ts on the assumption that a sweeper
 * job would scan `WHERE processed_at IS NULL`. No such sweeper was ever
 * shipped; the only access pattern that hits webhook_log today is the
 * INSERT IGNORE / point-UPDATE by `ratio_webhook_id` (already covered by
 * the unique constraint). Keeping the index just amplifies writes — every
 * insert and every processed_at update has to maintain a B-tree no reader
 * touches. Drop it.
 *
 * If a sweeper is later introduced, recreate the index then.
 */

import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX idx_webhook_log_unprocessed ON webhook_log`.execute(db);
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .createIndex('idx_webhook_log_unprocessed')
    .on('webhook_log')
    .columns(['processed_at'])
    .execute();
}
