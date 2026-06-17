/**
 * M1 — Catalog sync schema.
 *
 * Extends `meta_configs` with Phase 2 catalog/shop/feed columns and creates
 * the `catalog_sync_log` table for tracking sync runs.
 *
 * Migration is additive only (no destructive changes) so it can be rolled
 * forward on live databases without downtime. Rollback is provided for
 * local/dev use but is NOT intended for production rollback.
 */

import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  // ── Extend meta_configs ──────────────────────────────────────────────
  await sql`
    ALTER TABLE meta_configs
      ADD COLUMN catalog_id          VARCHAR(64)  NULL DEFAULT NULL AFTER events,
      ADD COLUMN commerce_account_id VARCHAR(64)  NULL DEFAULT NULL AFTER catalog_id,
      ADD COLUMN facebook_page_id    VARCHAR(64)  NULL DEFAULT NULL AFTER commerce_account_id,
      ADD COLUMN instagram_profile_id VARCHAR(64) NULL DEFAULT NULL AFTER facebook_page_id,
      ADD COLUMN feed_token          VARCHAR(64)  NULL DEFAULT NULL AFTER instagram_profile_id,
      ADD COLUMN last_sync_at        DATETIME(3)  NULL DEFAULT NULL AFTER feed_token,
      ADD COLUMN sync_enabled        BOOLEAN      NOT NULL DEFAULT FALSE AFTER last_sync_at,
      ADD COLUMN catalog_updated_at  DATETIME(3)  NULL DEFAULT NULL AFTER sync_enabled
  `.execute(db);

  // ── Create catalog_sync_log ──────────────────────────────────────────
  await db.schema
    .createTable('catalog_sync_log')
    .addColumn('id', sql`bigint unsigned`, (c) => c.notNull().autoIncrement().primaryKey())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('trigger', 'varchar(16)', (c) => c.notNull())
    .addColumn('status', 'varchar(16)', (c) => c.notNull())
    .addColumn('total_products', sql`int unsigned`)
    .addColumn('success_count', sql`int unsigned`)
    .addColumn('error_count', sql`int unsigned`)
    .addColumn('errors', 'json')
    .addColumn('started_at', 'datetime(3)', (c) => c.notNull())
    .addColumn('completed_at', 'datetime(3)')
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint(
      'fk_catalog_sync_log_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createIndex('idx_catalog_sync_log_merchant_started')
    .on('catalog_sync_log')
    .columns(['merchant_id', 'started_at'])
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('catalog_sync_log').ifExists().execute();

  await sql`
    ALTER TABLE meta_configs
      DROP COLUMN catalog_updated_at,
      DROP COLUMN sync_enabled,
      DROP COLUMN last_sync_at,
      DROP COLUMN feed_token,
      DROP COLUMN instagram_profile_id,
      DROP COLUMN facebook_page_id,
      DROP COLUMN commerce_account_id,
      DROP COLUMN catalog_id
  `.execute(db);
}
