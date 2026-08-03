import { type Kysely, sql } from 'kysely';

/**
 * Loyalty module initial schema — the three standard tables every module owns
 * (`merchants`, `oauth_tokens`, `webhook_log`) plus the 11 loyalty domain
 * tables from the TRD (`docs/agent/apps/loyalty/TRD.md` §3).
 *
 * This module has never been deployed, so the full schema ships as one
 * initial migration instead of template-columns + ALTERs.
 */
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
    .addColumn('received_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint('fk_webhook_log_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('set null'),
    )
    .execute();

  await db.schema
    .createIndex('idx_webhook_log_unprocessed')
    .on('webhook_log')
    .columns(['processed_at'])
    .execute();

  // ── loyalty_configs — per-merchant settings ───────────────────────────────
  await db.schema
    .createTable('loyalty_configs')
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull().primaryKey())
    .addColumn('program_name', 'varchar(64)', (c) => c.notNull().defaultTo('Coins'))
    .addColumn('base_earn_rate', sql`decimal(10,4)`, (c) => c.notNull().defaultTo('1'))
    .addColumn('coin_value_inr', sql`decimal(10,4)`, (c) => c.notNull().defaultTo('0.1'))
    .addColumn('storefront_base_url', 'varchar(255)')
    .addColumn('export_email', 'varchar(255)')
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint('fk_loyalty_configs_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  // ── loyalty_customers — the per-merchant customer mirror ──────────────────
  await db.schema
    .createTable('loyalty_customers')
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('phone', 'varchar(20)', (c) => c.notNull())
    .addColumn('name', 'varchar(255)')
    .addColumn('email', 'varchar(255)')
    .addColumn('points_balance', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('lifetime_earned', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('lifetime_redeemed', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('lifetime_expired', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('lifetime_adjusted', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('lifetime_spend', sql`decimal(14,2)`, (c) => c.notNull().defaultTo('0'))
    .addColumn('lifetime_orders', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_order_at', 'datetime(3)')
    .addColumn('first_seen_source', 'varchar(16)', (c) => c.notNull().defaultTo('order'))
    .addColumn('balance_synced_at', 'datetime(3)')
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addPrimaryKeyConstraint('pk_loyalty_customers', ['merchant_id', 'phone'])
    .addForeignKeyConstraint('fk_loyalty_customers_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();
  await db.schema
    .createIndex('idx_loyalty_customers_balance')
    .on('loyalty_customers')
    .columns(['merchant_id', 'points_balance'])
    .execute();
  await db.schema
    .createIndex('idx_loyalty_customers_spend')
    .on('loyalty_customers')
    .columns(['merchant_id', 'lifetime_spend'])
    .execute();
  await db.schema
    .createIndex('idx_loyalty_customers_last_order')
    .on('loyalty_customers')
    .columns(['merchant_id', 'last_order_at'])
    .execute();
  await db.schema
    .createIndex('idx_loyalty_customers_synced')
    .on('loyalty_customers')
    .columns(['merchant_id', 'balance_synced_at'])
    .execute();

  // ── bulk operations + rows ────────────────────────────────────────────────
  await db.schema
    .createTable('loyalty_bulk_operations')
    .addColumn('id', 'char(26)', (c) => c.notNull().primaryKey())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('type', 'varchar(8)', (c) => c.notNull())
    .addColumn('status', 'varchar(16)', (c) => c.notNull().defaultTo('validating'))
    .addColumn('file_name', 'varchar(255)')
    .addColumn('total_rows', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('valid_rows', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('invalid_rows', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('processed_rows', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('success_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('failure_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('total_points', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('created_by', 'varchar(128)')
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint('fk_loyalty_bulk_ops_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();
  await db.schema
    .createIndex('idx_loyalty_bulk_ops_merchant_created')
    .on('loyalty_bulk_operations')
    .columns(['merchant_id', 'created_at'])
    .execute();

  await db.schema
    .createTable('loyalty_bulk_operation_rows')
    .addColumn('id', 'bigint', (c) => c.notNull().autoIncrement().primaryKey())
    .addColumn('operation_id', 'char(26)', (c) => c.notNull())
    .addColumn('row_number', 'integer', (c) => c.notNull())
    .addColumn('phone', 'varchar(20)', (c) => c.notNull())
    .addColumn('points', 'integer', (c) => c.notNull())
    .addColumn('reason', 'varchar(500)')
    .addColumn('status', 'varchar(12)', (c) => c.notNull().defaultTo('pending'))
    .addColumn('error_reason', 'varchar(255)')
    .addColumn('core_transaction_id', 'varchar(64)')
    .addColumn('processed_at', 'datetime(3)')
    .addUniqueConstraint('uq_loyalty_bulk_rows_op_row', ['operation_id', 'row_number'])
    .addForeignKeyConstraint(
      'fk_loyalty_bulk_rows_operation',
      ['operation_id'],
      'loyalty_bulk_operations',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();
  await db.schema
    .createIndex('idx_loyalty_bulk_rows_op_status')
    .on('loyalty_bulk_operation_rows')
    .columns(['operation_id', 'status'])
    .execute();

  // ── earning rules ─────────────────────────────────────────────────────────
  await db.schema
    .createTable('loyalty_rules')
    .addColumn('id', 'char(26)', (c) => c.notNull().primaryKey())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('name', 'varchar(128)', (c) => c.notNull())
    .addColumn('rule_type', 'varchar(12)', (c) => c.notNull())
    .addColumn('value', sql`decimal(10,2)`, (c) => c.notNull())
    .addColumn('target_type', 'varchar(16)', (c) => c.notNull())
    .addColumn('conditions', 'json')
    .addColumn('starts_at', 'datetime(3)', (c) => c.notNull())
    .addColumn('ends_at', 'datetime(3)')
    .addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('priority', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint('fk_loyalty_rules_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();
  await db.schema
    .createIndex('idx_loyalty_rules_merchant_active')
    .on('loyalty_rules')
    .columns(['merchant_id', 'active'])
    .execute();

  await db.schema
    .createTable('loyalty_rule_customers')
    .addColumn('rule_id', 'char(26)', (c) => c.notNull())
    .addColumn('phone', 'varchar(20)', (c) => c.notNull())
    .addColumn('added_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addPrimaryKeyConstraint('pk_loyalty_rule_customers', ['rule_id', 'phone'])
    .addForeignKeyConstraint('fk_loyalty_rule_customers_rule', ['rule_id'], 'loyalty_rules', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createTable('loyalty_rule_applications')
    .addColumn('id', 'bigint', (c) => c.notNull().autoIncrement().primaryKey())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('rule_id', 'char(26)', (c) => c.notNull())
    .addColumn('order_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('phone', 'varchar(20)', (c) => c.notNull())
    .addColumn('base_points', 'integer', (c) => c.notNull())
    .addColumn('extra_points', 'integer', (c) => c.notNull())
    .addColumn('applied_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addUniqueConstraint('uq_loyalty_rule_apps_rule_order', ['rule_id', 'order_id'])
    .execute();
  await db.schema
    .createIndex('idx_loyalty_rule_apps_merchant_applied')
    .on('loyalty_rule_applications')
    .columns(['merchant_id', 'applied_at'])
    .execute();

  // ── QR campaigns + scans ──────────────────────────────────────────────────
  await db.schema
    .createTable('loyalty_qr_codes')
    .addColumn('id', 'char(26)', (c) => c.notNull().primaryKey())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('code', 'varchar(32)', (c) => c.notNull().unique())
    .addColumn('event_name', 'varchar(128)', (c) => c.notNull())
    .addColumn('points_per_scan', 'integer', (c) => c.notNull())
    .addColumn('max_scans', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('starts_at', 'datetime(3)', (c) => c.notNull())
    .addColumn('expires_at', 'datetime(3)', (c) => c.notNull())
    .addColumn('claim_message', 'varchar(255)')
    .addColumn('status', 'varchar(12)', (c) => c.notNull().defaultTo('ACTIVE'))
    .addColumn('scan_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('new_phone_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint('fk_loyalty_qr_codes_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();
  await db.schema
    .createIndex('idx_loyalty_qr_codes_merchant_status')
    .on('loyalty_qr_codes')
    .columns(['merchant_id', 'status'])
    .execute();

  await db.schema
    .createTable('loyalty_qr_scans')
    .addColumn('id', 'bigint', (c) => c.notNull().autoIncrement().primaryKey())
    .addColumn('qr_code_id', 'char(26)', (c) => c.notNull())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('phone', 'varchar(20)', (c) => c.notNull())
    .addColumn('is_new_phone', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('core_transaction_id', 'varchar(64)')
    .addColumn('converted_order_id', 'varchar(64)')
    .addColumn('converted_at', 'datetime(3)')
    .addColumn('scanned_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addUniqueConstraint('uq_loyalty_qr_scans_qr_phone', ['qr_code_id', 'phone'])
    .addForeignKeyConstraint('fk_loyalty_qr_scans_qr', ['qr_code_id'], 'loyalty_qr_codes', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();
  await db.schema
    .createIndex('idx_loyalty_qr_scans_merchant_scanned')
    .on('loyalty_qr_scans')
    .columns(['merchant_id', 'scanned_at'])
    .execute();
  await db.schema
    .createIndex('idx_loyalty_qr_scans_merchant_phone')
    .on('loyalty_qr_scans')
    .columns(['merchant_id', 'phone', 'scanned_at'])
    .execute();

  // ── exports ───────────────────────────────────────────────────────────────
  await db.schema
    .createTable('loyalty_exports')
    .addColumn('id', 'char(26)', (c) => c.notNull().primaryKey())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('filters', 'json', (c) => c.notNull())
    .addColumn('status', 'varchar(12)', (c) => c.notNull().defaultTo('pending'))
    .addColumn('row_count', 'integer')
    .addColumn('s3_key', 'varchar(512)')
    .addColumn('email', 'varchar(255)')
    .addColumn('emailed_at', 'datetime(3)')
    .addColumn('created_by', 'varchar(128)')
    .addColumn('completed_at', 'datetime(3)')
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint('fk_loyalty_exports_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();
  await db.schema
    .createIndex('idx_loyalty_exports_merchant_created')
    .on('loyalty_exports')
    .columns(['merchant_id', 'created_at'])
    .execute();

  // ── daily dashboard snapshots ─────────────────────────────────────────────
  await db.schema
    .createTable('loyalty_daily_stats')
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('stat_date', 'date', (c) => c.notNull())
    .addColumn('points_issued', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('points_redeemed', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('points_expired', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('bulk_credited', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('bulk_debited', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('qr_points', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('rule_extra_points', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('customers_with_balance', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('outstanding_points', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addPrimaryKeyConstraint('pk_loyalty_daily_stats', ['merchant_id', 'stat_date'])
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('loyalty_daily_stats').ifExists().execute();
  await db.schema.dropTable('loyalty_exports').ifExists().execute();
  await db.schema.dropTable('loyalty_qr_scans').ifExists().execute();
  await db.schema.dropTable('loyalty_qr_codes').ifExists().execute();
  await db.schema.dropTable('loyalty_rule_applications').ifExists().execute();
  await db.schema.dropTable('loyalty_rule_customers').ifExists().execute();
  await db.schema.dropTable('loyalty_rules').ifExists().execute();
  await db.schema.dropTable('loyalty_bulk_operation_rows').ifExists().execute();
  await db.schema.dropTable('loyalty_bulk_operations').ifExists().execute();
  await db.schema.dropTable('loyalty_customers').ifExists().execute();
  await db.schema.dropTable('loyalty_configs').ifExists().execute();
  await db.schema.dropTable('webhook_log').ifExists().execute();
  await db.schema.dropTable('oauth_tokens').ifExists().execute();
  await db.schema.dropTable('merchants').ifExists().execute();
}
