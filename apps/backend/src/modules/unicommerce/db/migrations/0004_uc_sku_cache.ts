import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('uc_sku_cache')
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('sku', 'varchar(64)', (c) => c.notNull())
    .addColumn('ratio_variant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('ratio_product_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addPrimaryKeyConstraint('pk_uc_sku_cache', ['merchant_id', 'sku'])
    .addForeignKeyConstraint('fk_uc_sku_cache_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();
}
