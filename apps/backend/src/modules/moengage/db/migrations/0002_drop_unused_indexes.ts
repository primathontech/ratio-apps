/**
 * D1 — drop `idx_webhook_log_unprocessed` from `webhook_log.processed_at`.
 *
 * Mirror of the posthog module's 0002_drop_unused_indexes. See that file
 * for the full rationale; in short, the index has no readers and only
 * adds write amplification to webhook_log inserts / processed_at updates.
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
