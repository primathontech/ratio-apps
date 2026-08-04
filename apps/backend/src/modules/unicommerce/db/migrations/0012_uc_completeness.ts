import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('uc_order_item_map')
    .addColumn('ordered_quantity', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('remaining_quantity', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_status', 'varchar(32)')
    .addColumn('last_status_updated_at', 'datetime(3)')
    .addColumn('sale_order_code', 'varchar(64)')
    .addColumn('source', 'varchar(32)', (c) => c.notNull().defaultTo('ratio_originated'))
    .execute();

  await db.schema
    .createTable('uc_variant_inventory')
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('variant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('facility_code', 'varchar(128)', (c) => c.notNull())
    .addColumn('sku', 'varchar(128)', (c) => c.notNull())
    .addColumn('inventory', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('updated_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addPrimaryKeyConstraint('pk_uc_variant_inventory', ['merchant_id', 'variant_id', 'facility_code'])
    .addForeignKeyConstraint('fk_uc_variant_inventory_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .alterTable('uc_credentials')
    .addColumn('last_inbound_call_at', 'datetime(3)')
    .addColumn('last_status_notification_at', 'datetime(3)')
    .execute();

  await db.schema
    .createTable('uc_reconciliation_jobs')
    .addColumn('id', 'char(36)', (c) => c.notNull().primaryKey().defaultTo(sql`(UUID())`))
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('requested_by', 'varchar(32)', (c) => c.notNull().defaultTo('system'))
    .addColumn('time_range_start', 'datetime(3)', (c) => c.notNull())
    .addColumn('time_range_end', 'datetime(3)', (c) => c.notNull())
    .addColumn('status', 'varchar(16)', (c) => c.notNull().defaultTo('RUNNING'))
    .addColumn('orders_checked_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('orders_pushed_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('orders_already_synced_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('orders_failed_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('started_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addColumn('completed_at', 'datetime(3)')
    .addForeignKeyConstraint('fk_uc_reconciliation_jobs_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createTable('uc_alerts')
    .addColumn('id', 'char(36)', (c) => c.notNull().primaryKey().defaultTo(sql`(UUID())`))
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('type', 'varchar(32)', (c) => c.notNull())
    .addColumn('reference', 'varchar(255)')
    .addColumn('detected_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addColumn('acknowledged_at', 'datetime(3)')
    .addColumn('acknowledged_by', 'varchar(255)')
    .addForeignKeyConstraint('fk_uc_alerts_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();
}
