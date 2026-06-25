/**
 * 0007 — Webhook delivery log for admin visibility.
 *
 * Records every incoming product webhook and its outcome (sent / skipped /
 * ignored / failed) so merchants can verify product pushes to Facebook from
 * the admin app without reading server logs.
 *
 * Additive only — safe to roll forward on live DBs.
 */

import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('webhook_delivery_log')
    .addColumn('id', sql`bigint unsigned`, (c) => c.notNull().autoIncrement().primaryKey())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('event_type', 'varchar(32)', (c) => c.notNull()) // product.created | product.updated | product.deleted
    .addColumn('product_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('product_title', 'varchar(512)')
    // sent | skipped | ignored | failed
    .addColumn('status', 'varchar(16)', (c) => c.notNull())
    .addColumn('sent_count', sql`int unsigned`, (c) => c.notNull().defaultTo(0))
    .addColumn('failed_count', sql`int unsigned`, (c) => c.notNull().defaultTo(0))
    .addColumn('reason', 'varchar(512)')
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint(
      'fk_webhook_delivery_log_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createIndex('idx_webhook_delivery_log_merchant_created')
    .on('webhook_delivery_log')
    .columns(['merchant_id', 'created_at'])
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('webhook_delivery_log').ifExists().execute();
}
