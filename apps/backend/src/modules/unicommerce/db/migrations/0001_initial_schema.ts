/**
 * 0001 — Squashed initial schema for the unicommerce module.
 *
 * This single file replaces the original 14 incremental migrations, applied
 * in order:
 *
 *   0001_initial.ts
 *   0002_uc_credentials.ts
 *   0003_uc_access_tokens.ts
 *   0004_uc_sku_cache.ts
 *   0005_uc_order_item_map.ts
 *   0006_uc_sync_jobs.ts
 *   0007_uc_order_item_map_unique.ts
 *   0008_drop_order_item_map_merchant_fk.ts
 *   0009_uc_event_logs.ts
 *   0010_uc_event_logs_job_id.ts
 *   0011_uc_credentials_password_enc.ts
 *   0012_uc_completeness.ts
 *   0013_uc_configs.ts
 *   0014_uc_credentials_store_domain.ts
 *
 * It creates the exact FINAL schema those 14 files together produce, not a
 * design change. This is safe to squash because the unicommerce module has
 * never been deployed anywhere with real production data — there is no
 * migration history to preserve on any live database. The git history of the
 * deleted files retains the full incremental narrative for anyone who needs
 * it.
 *
 * Deliberate end-state decisions carried forward from the incremental files
 * (each is a real bug/security call, not an accident):
 *
 * - `uc_order_item_map.merchant_id` has NO foreign key. 0005 originally added
 *   `fk_uc_order_item_map_merchant`, and 0008 deliberately dropped it: the FK
 *   caused a reproduced cross-connection lock-wait deadlock ("Lock wait
 *   timeout exceeded") with WebhooksService's `SELECT ... FOR UPDATE` on
 *   `merchants`, because UcOrderItemMapService writes via its own pooled
 *   connection. The merchant is already validated by webhook dispatch, so the
 *   FK enforced nothing the app layer doesn't guarantee.
 * - `uc_event_logs.job_id` is a plain nullable column with NO foreign key to
 *   `uc_sync_jobs(id)` — same class of cross-connection deadlock 0010
 *   deliberately avoided. Only order_push/cancel_push events set it; the app
 *   layer already knows the job id is valid at every write site.
 * - `uc_credentials` stores the password as `password_enc` (reversible
 *   AES-GCM ciphertext), not the one-way `password_hash` scrypt value from
 *   0002. 0011 made this switch deliberately (admin UI can reveal the
 *   previously-generated password), dropping existing hashed rows — fine for a
 *   pre-production module, and a fresh CREATE simply defines the column under
 *   its final name.
 * - `uc_order_item_map` keeps BOTH indexes: the non-unique
 *   `idx_uc_order_item_map_order` (order-level lookups) and the unique
 *   `idx_uc_order_item_map_lookup` (DB-level idempotency backstop for the
 *   check-then-act race in UcOrderItemMapService.generate()).
 * - `uc_credentials.store_domain` (0014) captures each merchant's REAL
 *   storefront domain at OAuth install time, fixing productUrl building that
 *   previously used a single global env var for every merchant.
 */
import { type Kysely, sql } from 'kysely';

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
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
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
    .addForeignKeyConstraint('fk_oauth_tokens_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
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
    .addColumn('received_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addForeignKeyConstraint('fk_webhook_log_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('set null'),
    )
    .execute();

  await db.schema
    .createIndex('idx_webhook_log_unprocessed')
    .on('webhook_log')
    .columns(['processed_at'])
    .execute();

  // Column `password_enc` (not 0002's `password_hash`) — final name after
  // 0011's scrypt→AES-GCM switch; `store_domain` added by 0014.
  await db.schema
    .createTable('uc_credentials')
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull().primaryKey())
    .addColumn('ratio_username', 'varchar(64)', (c) => c.notNull().unique())
    .addColumn('password_enc', 'varchar(255)', (c) => c.notNull())
    .addColumn('uc_username', 'varchar(255)', (c) => c.notNull())
    .addColumn('status', 'varchar(16)', (c) => c.notNull().defaultTo('active'))
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('last_inbound_call_at', 'datetime(3)')
    .addColumn('last_status_notification_at', 'datetime(3)')
    .addColumn('store_domain', 'varchar(255)')
    .addForeignKeyConstraint('fk_uc_credentials_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createTable('uc_access_tokens')
    .addColumn('token_hash', 'varchar(255)', (c) => c.notNull().primaryKey())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('issued_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addColumn('expires_at', 'datetime(3)', (c) => c.notNull())
    .addForeignKeyConstraint('fk_uc_access_tokens_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  await db.schema.createIndex('idx_uc_access_tokens_merchant').on('uc_access_tokens').columns(['merchant_id']).execute();

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

  // NO foreign key on merchant_id — 0008 dropped 0005's
  // `fk_uc_order_item_map_merchant` after reproducing a cross-connection
  // lock-wait deadlock with webhook dispatch's `SELECT ... FOR UPDATE` on
  // `merchants`. Do not reintroduce it.
  await db.schema
    .createTable('uc_order_item_map')
    .addColumn('order_item_id', 'varchar(45)', (c) => c.notNull().primaryKey()) // ≤45 chars per Unicommerce's own field limit
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('ratio_order_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('ratio_line_item_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addColumn('ordered_quantity', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('remaining_quantity', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_status', 'varchar(32)')
    .addColumn('last_status_updated_at', 'datetime(3)')
    .addColumn('sale_order_code', 'varchar(64)')
    .addColumn('source', 'varchar(32)', (c) => c.notNull().defaultTo('ratio_originated'))
    .execute();

  await db.schema
    .createIndex('idx_uc_order_item_map_order')
    .on('uc_order_item_map')
    .columns(['merchant_id', 'ratio_order_id'])
    .execute();

  // Unique idempotency backstop (0007): turns a lost SELECT-then-INSERT race
  // in UcOrderItemMapService.generate() into a rejected duplicate INSERT.
  await db.schema
    .createIndex('idx_uc_order_item_map_lookup')
    .on('uc_order_item_map')
    .columns(['merchant_id', 'ratio_order_id', 'ratio_line_item_id'])
    .unique()
    .execute();

  await db.schema
    .createTable('uc_sync_jobs')
    .addColumn('id', 'char(36)', (c) => c.notNull().primaryKey().defaultTo(sql`(UUID())`))
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('type', 'varchar(32)', (c) => c.notNull()) // 'order_push' | 'cancel_push'
    .addColumn('ratio_order_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('payload', 'json', (c) => c.notNull())
    .addColumn('status', 'varchar(16)', (c) => c.notNull().defaultTo('PENDING')) // PENDING|RETRYING|NEEDS_MANUAL|DONE
    .addColumn('attempt_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('next_retry_at', 'datetime(3)')
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    // Set once an `order_push` job's push succeeds (the Unicommerce-assigned
    // saleOrderCode). Task 9's `orders/cancelled` handler reads this back via
    // `UcOrderItemMapService.findSaleOrderCode` to know what to cancel — a
    // NULL value means the order was never successfully pushed in the first
    // place, which the cancel handler treats as a no-op.
    .addColumn('sale_order_code', 'varchar(64)')
    .addForeignKeyConstraint('fk_uc_sync_jobs_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createTable('uc_dlq')
    .addColumn('id', 'char(36)', (c) => c.notNull().primaryKey().defaultTo(sql`(UUID())`))
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('original_job_id', 'char(36)', (c) => c.notNull())
    .addColumn('payload', 'json', (c) => c.notNull())
    .addColumn('attempts', 'integer', (c) => c.notNull())
    .addColumn('last_error', 'text', (c) => c.notNull())
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .execute();

  await db.schema.createIndex('idx_uc_sync_jobs_retry').on('uc_sync_jobs').columns(['status', 'next_retry_at']).execute();

  await db.schema
    .createTable('uc_event_logs')
    .addColumn('id', 'char(36)', (c) => c.notNull().primaryKey().defaultTo(sql`(UUID())`))
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('direction', 'varchar(16)', (c) => c.notNull()) // 'inbound' | 'outbound'
    .addColumn('flow', 'varchar(32)', (c) => c.notNull()) // auth|order_push|inventory|dispatch|cancel|status|catalog
    .addColumn('reference', 'varchar(128)', (c) => c.notNull())
    .addColumn('result', 'varchar(16)', (c) => c.notNull()) // success|failed|partial
    .addColumn('payload', 'json', (c) => c.notNull())
    .addColumn('response', 'json')
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    // Deliberately NO FK to `uc_sync_jobs(id)` (0010) — event-log writes can
    // run on a different connection than a caller holding a lock on a related
    // row, so a synchronous FK risks the same cross-connection lock-wait
    // deadlock 0008 fixed on uc_order_item_map.
    .addColumn('job_id', 'char(36)')
    .addForeignKeyConstraint('fk_uc_event_logs_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createIndex('idx_uc_event_logs_merchant_created')
    .on('uc_event_logs')
    .columns(['merchant_id', 'created_at'])
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
  // Reverse dependency order: every child table (FKs into merchants) first,
  // then the shared `merchants` table itself.
  await db.schema.dropTable('uc_configs').ifExists().execute();
  await db.schema.dropTable('uc_alerts').ifExists().execute();
  await db.schema.dropTable('uc_reconciliation_jobs').ifExists().execute();
  await db.schema.dropTable('uc_variant_inventory').ifExists().execute();
  await db.schema.dropTable('uc_event_logs').ifExists().execute();
  await db.schema.dropTable('uc_dlq').ifExists().execute();
  await db.schema.dropTable('uc_sync_jobs').ifExists().execute();
  await db.schema.dropTable('uc_order_item_map').ifExists().execute();
  await db.schema.dropTable('uc_sku_cache').ifExists().execute();
  await db.schema.dropTable('uc_access_tokens').ifExists().execute();
  await db.schema.dropTable('uc_credentials').ifExists().execute();
  await db.schema.dropTable('webhook_log').ifExists().execute();
  await db.schema.dropTable('oauth_tokens').ifExists().execute();
  await db.schema.dropTable('merchants').ifExists().execute();
}
