import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('uc_order_item_map')
    .addColumn('order_item_id', 'varchar(45)', (c) => c.notNull().primaryKey()) // ≤45 chars per Unicommerce's own field limit
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('ratio_order_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('ratio_line_item_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addForeignKeyConstraint('fk_uc_order_item_map_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createIndex('idx_uc_order_item_map_order')
    .on('uc_order_item_map')
    .columns(['merchant_id', 'ratio_order_id'])
    .execute();
}
