import { type Kysely, sql } from 'kysely';

// TODO(D9): `webhook_log.id` defaults to `UUID()` (UUIDv1), which is
// random-ordered and fragments the primary-key B-tree. MySQL 9.7 does not
// yet provide `UUID_v7()` (verified — error 1305), and an app-layer UUIDv7
// generator hasn't been adopted. Revisit and migrate the default to a
// time-ordered generator once either is available; see the matching
// comment on WebhooksService for the rollout options.
//
// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('merchants')
    .addColumn('id', 'varchar(128)', (c) => c.notNull().primaryKey())
    .addColumn('is_active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('installed_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('uninstalled_at', 'datetime(3)')
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .execute();

  await db.schema
    .createTable('oauth_tokens')
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull().primaryKey())
    .addColumn('access_token_enc', 'text', (c) => c.notNull())
    .addColumn('refresh_token_enc', 'text', (c) => c.notNull())
    .addColumn('expires_at', 'datetime(3)', (c) => c.notNull())
    .addColumn('scopes', 'text', (c) => c.notNull())
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint(
      'fk_oauth_tokens_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createTable('webhook_log')
    .addColumn('id', 'char(36)', (c) => c.notNull().primaryKey().defaultTo(sql`(UUID())`))
    .addColumn('ratio_webhook_id', 'varchar(255)', (c) => c.notNull().unique())
    .addColumn('merchant_id', 'varchar(128)')
    .addColumn('topic', 'varchar(128)', (c) => c.notNull())
    .addColumn('payload', 'json', (c) => c.notNull())
    .addColumn('signature_ok', 'boolean', (c) => c.notNull())
    .addColumn('processed_at', 'datetime(3)')
    .addColumn('received_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint(
      'fk_webhook_log_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .execute();

  await db.schema
    .createIndex('idx_webhook_log_unprocessed')
    .on('webhook_log')
    .columns(['processed_at'])
    .execute();

  // google_configs — one row per merchant; all three integrations + sync flags.
  await db.schema
    .createTable('google_configs')
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull().primaryKey())
    .addColumn('connection_method', sql`enum('oauth','manual')`, (c) =>
      c.notNull().defaultTo('manual'),
    )
    .addColumn('google_account_email', 'varchar(320)')
    // GA4
    .addColumn('ga4_enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('ga4_measurement_id', 'varchar(20)')
    .addColumn('ga4_pixel_id', 'varchar(128)')
    .addColumn('ga4_pixel_status', sql`enum('active','pending_api','error','disabled')`, (c) =>
      c.notNull().defaultTo('disabled'),
    )
    // Google Ads
    .addColumn('ads_enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('ads_conversion_id', 'varchar(32)')
    .addColumn('ads_conversion_label', 'varchar(64)')
    .addColumn('ads_pixel_id', 'varchar(128)')
    .addColumn('ads_pixel_status', sql`enum('active','pending_api','error','disabled')`, (c) =>
      c.notNull().defaultTo('disabled'),
    )
    .addColumn('enhanced_conversions_enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    // GMC
    .addColumn('gmc_enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('gmc_merchant_id', 'varchar(32)')
    // Encrypted service-account JSON key (secret) — TEXT for ciphertext length.
    .addColumn('gmc_service_account_key_enc', 'text')
    .addColumn('gmc_target_country', 'varchar(2)', (c) => c.notNull().defaultTo('IN'))
    .addColumn('gmc_content_language', 'varchar(5)', (c) => c.notNull().defaultTo('en'))
    .addColumn('gmc_currency', 'varchar(3)', (c) => c.notNull().defaultTo('INR'))
    .addColumn('gmc_default_condition', sql`enum('new','refurbished','used')`, (c) =>
      c.notNull().defaultTo('new'),
    )
    .addColumn('gmc_brand_override', 'varchar(255)')
    .addColumn('gmc_google_product_category', 'varchar(255)')
    .addColumn('gmc_category_mode', sql`enum('auto','default','per_type')`, (c) =>
      c.notNull().defaultTo('default'),
    )
    // Sync settings
    .addColumn('auto_sync_enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('hourly_reconcile_enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('sync_variants_enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('include_out_of_stock', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('free_listings_enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint('fk_google_configs_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  // google_credentials — Google OAuth tokens (distinct from Ratio's). Encrypted.
  await db.schema
    .createTable('google_credentials')
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull().primaryKey())
    .addColumn('access_token_enc', 'text', (c) => c.notNull())
    .addColumn('refresh_token_enc', 'text')
    .addColumn('expires_at', 'datetime(3)')
    .addColumn('granted_scopes', 'text')
    .addColumn('needs_reconnect', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint(
      'fk_google_credentials_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  // google_feed_items — per product/variant GMC feed health.
  await db.schema
    .createTable('google_feed_items')
    .addColumn('id', 'bigint', (c) => c.notNull().primaryKey().autoIncrement())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('offer_id', 'varchar(255)', (c) => c.notNull())
    .addColumn('product_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('variant_id', 'varchar(128)')
    .addColumn('title', 'varchar(255)')
    .addColumn('status', sql`enum('SYNCED','PENDING','ERROR','WARNING','DELETED')`, (c) =>
      c.notNull(),
    )
    .addColumn('has_gtin', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('issue', 'varchar(512)')
    .addColumn('last_synced_at', 'datetime(3)')
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addUniqueConstraint('uq_google_feed_items_merchant_offer', ['merchant_id', 'offer_id'])
    .addForeignKeyConstraint(
      'fk_google_feed_items_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  // Filtered feed-details view scans by (merchant, status).
  await db.schema
    .createIndex('idx_google_feed_items_merchant_status')
    .on('google_feed_items')
    .columns(['merchant_id', 'status'])
    .execute();

  // google_sync_log — sync-history rows for the admin.
  await db.schema
    .createTable('google_sync_log')
    .addColumn('id', 'bigint', (c) => c.notNull().primaryKey().autoIncrement())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('sync_type', sql`enum('webhook','auto','reconcile','initial','manual')`, (c) =>
      c.notNull(),
    )
    .addColumn('products_checked', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('products_updated', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('products_errored', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('detail', 'varchar(512)')
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint(
      'fk_google_sync_log_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createIndex('idx_google_sync_log_merchant_created')
    .on('google_sync_log')
    .columns(['merchant_id', 'created_at'])
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('google_sync_log').ifExists().execute();
  await db.schema.dropTable('google_feed_items').ifExists().execute();
  await db.schema.dropTable('google_credentials').ifExists().execute();
  await db.schema.dropTable('google_configs').ifExists().execute();
  await db.schema.dropTable('webhook_log').ifExists().execute();
  await db.schema.dropTable('oauth_tokens').ifExists().execute();
  await db.schema.dropTable('merchants').ifExists().execute();
}
