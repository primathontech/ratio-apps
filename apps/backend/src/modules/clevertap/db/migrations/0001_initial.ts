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
    .createTable('clevertap_configs')
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull().primaryKey())
    .addColumn('account_id', 'varchar(64)', (c) => c.notNull().defaultTo(''))
    .addColumn('passcode_enc', 'text')
    .addColumn('region', 'varchar(8)', (c) => c.notNull().defaultTo('in1'))
    .addColumn('server_events_enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('debug', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('events', 'json', (c) => c.notNull())
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint(
      'fk_clevertap_configs_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createTable('clevertap_forwarded_events')
    .addColumn('id', 'char(36)', (c) => c.notNull().primaryKey().defaultTo(sql`(UUID())`))
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('idempotency_key', 'varchar(255)', (c) => c.notNull())
    .addColumn('topic', 'varchar(128)', (c) => c.notNull())
    .addColumn('clevertap_event', 'varchar(64)', (c) => c.notNull())
    .addColumn('status', 'varchar(16)', (c) => c.notNull())
    .addColumn('error', 'text')
    .addColumn('sent_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addForeignKeyConstraint(
      'fk_clevertap_forwarded_events_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createIndex('uq_clevertap_forwarded_events_key')
    .on('clevertap_forwarded_events')
    .columns(['merchant_id', 'idempotency_key'])
    .unique()
    .execute();

  await db.schema
    .createIndex('idx_clevertap_forwarded_events_recent')
    .on('clevertap_forwarded_events')
    .columns(['merchant_id', 'sent_at'])
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('clevertap_forwarded_events').ifExists().execute();
  await db.schema.dropTable('clevertap_configs').ifExists().execute();
  await db.schema.dropTable('webhook_log').ifExists().execute();
  await db.schema.dropTable('oauth_tokens').ifExists().execute();
  await db.schema.dropTable('merchants').ifExists().execute();
}
