/**
 * 0001 — Wizzy (AI Search & Discovery) initial schema.
 *
 * Shared tables (merchants / oauth_tokens / webhook_log) come from
 * {@link createSharedTables}; this adds the three Wizzy-specific tables:
 *   - `wizzy_configs`        — per-merchant connection + sync settings (1 row)
 *   - `wizzy_catalog_items`  — per-product sync health for the catalog screen
 *   - `wizzy_sync_log`       — sync-run history for the admin
 *
 * The Store Secret and API Key are both encrypted at rest (CryptoService) —
 * columns hold ciphertext.
 */
import { type Kysely, sql } from 'kysely';
import { createSharedTables, dropSharedTables } from '../../../../core/db/shared-migrations';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await createSharedTables(db);

  await db.schema
    .createTable('wizzy_configs')
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull().primaryKey())
    .addColumn('wizzy_enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('store_id', 'varchar(128)')
    // Encrypted (CryptoService) Wizzy Store Secret. Never returned raw.
    .addColumn('store_secret_enc', 'text')
    // Encrypted (CryptoService) Wizzy API Key. Never returned raw.
    .addColumn('api_key_enc', 'text')
    .addColumn('sdk_url', 'varchar(512)', (c) =>
      c.notNull().defaultTo('https://cdn.wizzy.ai/sdk/v2/wizzy.min.js'),
    )
    .addColumn('script_tag_id', 'varchar(128)')
    .addColumn('script_tag_status', sql`enum('active','pending_api','error','disabled')`, (c) =>
      c.notNull().defaultTo('disabled'),
    )
    .addColumn('auto_sync_enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('include_out_of_stock', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('strip_html_description', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('last_bulk_sync_at', 'datetime(3)')
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint('fk_wizzy_configs_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createTable('wizzy_catalog_items')
    .addColumn('id', 'bigint', (c) => c.notNull().primaryKey().autoIncrement())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('product_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('wizzy_id', 'varchar(255)', (c) => c.notNull())
    .addColumn('title', 'varchar(255)')
    .addColumn('status', sql`enum('SYNCED','PENDING','ERROR','DELETED')`, (c) =>
      c.notNull().defaultTo('PENDING'),
    )
    .addColumn('issue', 'varchar(512)')
    .addColumn('last_synced_at', 'datetime(3)')
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addUniqueConstraint('uq_wizzy_catalog_merchant_product', ['merchant_id', 'product_id'])
    .addForeignKeyConstraint(
      'fk_wizzy_catalog_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createIndex('idx_wizzy_catalog_status')
    .on('wizzy_catalog_items')
    .columns(['merchant_id', 'status'])
    .execute();

  await db.schema
    .createTable('wizzy_sync_log')
    .addColumn('id', 'bigint', (c) => c.notNull().primaryKey().autoIncrement())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('sync_type', sql`enum('initial','webhook','auto','manual','reconcile')`, (c) =>
      c.notNull(),
    )
    .addColumn('products_checked', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('products_synced', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('products_errored', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('detail', 'varchar(512)')
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addForeignKeyConstraint('fk_wizzy_sync_log_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createIndex('idx_wizzy_sync_log_merchant')
    .on('wizzy_sync_log')
    .columns(['merchant_id', 'created_at'])
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('wizzy_sync_log').ifExists().execute();
  await db.schema.dropTable('wizzy_catalog_items').ifExists().execute();
  await db.schema.dropTable('wizzy_configs').ifExists().execute();
  await dropSharedTables(db);
}
