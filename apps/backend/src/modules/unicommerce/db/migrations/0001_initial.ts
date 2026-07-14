import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
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

  await db.schema
    .createTable('uc_credentials')
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull().primaryKey())
    .addColumn('tenant_slug', 'varchar(255)', (c) => c.notNull())
    .addColumn('username_enc', 'text', (c) => c.notNull())
    .addColumn('password_enc', 'text', (c) => c.notNull())
    .addColumn('facility_code', 'varchar(255)', (c) => c.notNull())
    .addColumn('active', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('kill_switch', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('oauth_access_token_enc', 'text')
    .addColumn('oauth_refresh_token_enc', 'text')
    .addColumn('oauth_expires_at', 'datetime(3)')
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint(
      'fk_uc_credentials_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createTable('uc_sync_queue')
    .addColumn('id', 'varchar(36)', (c) => c.notNull().primaryKey())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('order_id', 'varchar(255)', (c) => c.notNull())
    .addColumn('sync_type', 'varchar(64)', (c) => c.notNull())
    .addColumn('status', 'varchar(64)', (c) => c.notNull().defaultTo('pending'))
    .addColumn('retry_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('next_retry_at', 'datetime(3)')
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .execute();

  await db.schema
    .createIndex('idx_uc_sync_queue_status')
    .on('uc_sync_queue')
    .columns(['status', 'next_retry_at'])
    .execute();

  await db.schema
    .createTable('uc_sync_log')
    .addColumn('id', 'varchar(36)', (c) => c.notNull().primaryKey())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('sync_type', 'varchar(64)', (c) => c.notNull())
    .addColumn('status', 'varchar(64)', (c) => c.notNull())
    .addColumn('item_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('error_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_run_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .execute();

  await db.schema
    .createTable('uc_circuit_breaker')
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull().primaryKey())
    .addColumn('tripped', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('failure_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_failure_at', 'datetime(3)')
    .addColumn('tripped_at', 'datetime(3)')
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('uc_circuit_breaker').ifExists().execute();
  await db.schema.dropTable('uc_sync_log').ifExists().execute();
  await db.schema.dropTable('uc_sync_queue').ifExists().execute();
  await db.schema.dropTable('uc_credentials').ifExists().execute();
  await db.schema.dropTable('webhook_log').ifExists().execute();
  await db.schema.dropTable('oauth_tokens').ifExists().execute();
  await db.schema.dropTable('merchants').ifExists().execute();
}
