/**
 * 0001 — FBT initial schema. GREENFIELD.
 *
 * `fbt_app` is a fresh, empty database in every environment. The old FBT production
 * schema is never read, written, or migrated (spec Revision 1), so this is an ordinary
 * initial migration: no `information_schema` guards, no ALTERs, no additive-only
 * constraint, no backfill.
 *
 * Shared tables (merchants / oauth_tokens / webhook_log) come from
 * `createSharedTables`. Everything else is `fbt_`-prefixed, has a real foreign key to
 * `merchants`, and carries no `platform` column.
 */
import { type Kysely, sql } from 'kysely';
import { createSharedTables, dropSharedTables } from '../../../../core/db/shared-migrations';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await createSharedTables(db);

  await db.schema
    .createTable('fbt_bundles')
    .addColumn('id', 'varchar(36)', (c) => c.notNull().primaryKey())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('name', 'varchar(255)', (c) => c.notNull())
    .addColumn('status', sql`enum('draft','published','paused','archived')`, (c) => c.notNull())
    .addColumn(
      'scope_type',
      sql`enum('all_products','specific_product','specific_collections')`,
      (c) => c.notNull(),
    )
    .addColumn('scope_product_ids', 'json')
    .addColumn('scope_collection_ids', 'json')
    .addColumn('start_date', 'datetime(3)')
    .addColumn('end_date', 'datetime(3)')
    .addColumn('recommendation_count', 'integer')
    .addColumn('recommendation_product_list', 'json')
    .addColumn('ui_config', 'json', (c) => c.notNull())
    .addColumn('per_card_config', 'json')
    .addColumn('mode', sql`enum('auto','manual')`, (c) => c.notNull().defaultTo('manual'))
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint('fk_fbt_bundles_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createIndex('idx_fbt_bundles_merchant_status')
    .on('fbt_bundles')
    .columns(['merchant_id', 'status'])
    .execute();

  await db.schema
    .createIndex('idx_fbt_bundles_mode')
    .on('fbt_bundles')
    .columns(['merchant_id', 'mode'])
    .execute();

  // merchant_id IS the primary key — one row per merchant, no surrogate id.
  await db.schema
    .createTable('fbt_merchant_config')
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull().primaryKey())
    .addColumn('allow_automatic_recommendation', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('recommendation_count', 'integer', (c) => c.notNull().defaultTo(3))
    .addColumn('product_excluded_list', 'json')
    .addColumn('products_widget_disabled_list', 'json')
    .addColumn('ui_config', 'json')
    .addColumn('sync_frequency', sql`enum('daily','weekly')`, (c) => c.notNull().defaultTo('daily'))
    // `sql`tinyint`` not `'tinyint'`: Kysely's ColumnDataType union has no 'tinyint'
    // member (it is MySQL-specific), so the string literal fails `tsc --noEmit`. This
    // exact form was verified working on the superseded branch.
    //
    // Signed, not `tinyint unsigned`: the ranges are 0..23 and 0..6, which fit signed
    // tinyint (-128..127) with room to spare, and `fbtMerchantConfigSchema` already
    // enforces the bounds at the app layer. Using the proven form avoids risking a
    // second `sql` variant for no behavioural gain.
    .addColumn('sync_hour_utc', sql`tinyint`, (c) => c.notNull().defaultTo(4))
    .addColumn('sync_weekday', sql`tinyint`)
    .addColumn('next_run_at', 'datetime(3)')
    .addColumn('last_run_at', 'datetime(3)')
    .addColumn('preview_base_url', 'varchar(255)')
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint(
      'fk_fbt_merchant_config_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  // Drives the sweep's due-selection query (Plan 3).
  await db.schema
    .createIndex('idx_fbt_config_next_run_at')
    .on('fbt_merchant_config')
    .columns(['next_run_at'])
    .execute();

  await db.schema
    .createTable('fbt_product_embeddings')
    .addColumn('id', 'varchar(36)', (c) => c.notNull().primaryKey())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('product_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('product_title', 'varchar(500)', (c) => c.notNull())
    .addColumn('product_description', 'text')
    // Float32Array buffer — ~6 KB vs ~15-20 KB as JSON for 1536 floats, and far
    // cheaper to parse. Cosine similarity runs in app code, so a sweep loads every
    // embedding for the merchant.
    //
    // Plain `blob` (64 KB max) is deliberate, not lazy: 1536 floats × 4 bytes = 6 KB,
    // and even a 3072-dimension model would be 12 KB. LONGBLOB would be four orders of
    // magnitude of unused headroom. `'blob'` is a real Kysely ColumnDataType, so no
    // `sql` escape hatch is needed here.
    .addColumn('embedding_blob', 'blob', (c) => c.notNull())
    .addColumn('embedding_model', 'varchar(100)', (c) =>
      c.notNull().defaultTo('text-embedding-3-small'),
    )
    .addColumn('embedding_dimensions', 'integer', (c) => c.notNull().defaultTo(1536))
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addColumn('last_updated', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addUniqueConstraint('uq_fbt_embeddings_merchant_product', ['merchant_id', 'product_id'])
    .addForeignKeyConstraint(
      'fk_fbt_embeddings_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createIndex('idx_fbt_embeddings_model')
    .on('fbt_product_embeddings')
    .columns(['merchant_id', 'embedding_model'])
    .execute();

  await db.schema
    .createTable('fbt_similarity_cache')
    .addColumn('id', 'varchar(36)', (c) => c.notNull().primaryKey())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('source_product_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('similar_products', 'json', (c) => c.notNull())
    .addColumn('cache_expires_at', 'datetime(3)', (c) => c.notNull())
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addUniqueConstraint('uq_fbt_similarity_merchant_source', ['merchant_id', 'source_product_id'])
    .addForeignKeyConstraint(
      'fk_fbt_similarity_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createIndex('idx_fbt_similarity_expires')
    .on('fbt_similarity_cache')
    .columns(['cache_expires_at'])
    .execute();

  await db.schema
    .createTable('fbt_generation_jobs')
    .addColumn('id', 'varchar(36)', (c) => c.notNull().primaryKey())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn(
      'job_type',
      sql`enum('full_sync','incremental','single_product','embedding_generation')`,
      (c) => c.notNull(),
    )
    .addColumn('status', sql`enum('pending','running','completed','failed','cancelled')`, (c) =>
      c.notNull().defaultTo('pending'),
    )
    .addColumn('total_products', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('processed_products', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('created_bundles', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('created_embeddings', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('error_message', 'text')
    .addColumn('started_at', 'datetime(3)')
    .addColumn('completed_at', 'datetime(3)')
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint('fk_fbt_jobs_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createIndex('idx_fbt_jobs_merchant_created')
    .on('fbt_generation_jobs')
    .columns(['merchant_id', 'created_at'])
    .execute();

  // Row lease rather than MySQL GET_LOCK: GET_LOCK is scoped to a CONNECTION, and
  // Kysely hands out pooled connections, so a release can land on a different
  // connection than the acquire and leak the lock. A row lease is atomic,
  // connection-independent, and self-heals on expiry. Plan 3 consumes it.
  await db.schema
    .createTable('fbt_sweep_lease')
    .addColumn('lease_key', 'varchar(64)', (c) => c.notNull().primaryKey())
    .addColumn('locked_until', 'datetime(3)', (c) => c.notNull())
    .addColumn('locked_by', 'varchar(128)')
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .execute();

  // Seed the single row already expired, so the first acquire succeeds.
  await sql`
    INSERT INTO fbt_sweep_lease (lease_key, locked_until, locked_by)
    VALUES ('sweep', '1970-01-01 00:00:00.000', NULL)
  `.execute(db);
}

/**
 * Local/CI rollback. `migrate-down.ts` refuses `NODE_ENV=production` without
 * `I_REALLY_MEAN_IT=yes`, and refuses any migration matching /initial/ without
 * `--yes-i-know-this-drops-tables`.
 *
 * Order matters: every fbt_ table FKs into `merchants`, so they all drop first.
 */
// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('fbt_sweep_lease').ifExists().execute();
  await db.schema.dropTable('fbt_generation_jobs').ifExists().execute();
  await db.schema.dropTable('fbt_similarity_cache').ifExists().execute();
  await db.schema.dropTable('fbt_product_embeddings').ifExists().execute();
  await db.schema.dropTable('fbt_merchant_config').ifExists().execute();
  await db.schema.dropTable('fbt_bundles').ifExists().execute();
  await dropSharedTables(db);
}
