import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('uc_configs')
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull().primaryKey())
    .addColumn('product_sync_enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('inventory_sync_enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('order_push_enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('dispatch_status_sync_enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('cancel_sync_enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('notifications_enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint('fk_uc_configs_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('uc_configs').execute();
}
