/**
 * Shared-table DDL for future module 0001 migrations to call. The existing
 * _template/_template 0001 migrations predate this helper and duplicate the DDL;
 * do NOT refactor them to use this (they're already applied — changing them
 * is moot).
 *
 * Notably: this helper does NOT create `idx_webhook_log_unprocessed` (the
 * dead index that 0002 drops). Future modules' 0001 will end up with a leaner
 * webhook_log right away — no 0002 equivalent needed.
 *
 * Fails loudly on stale state by design (no `.ifNotExists()`) — if you see
 * "table already exists" during migrate, fix the DB state first.
 */

/**
 * Shared DDL for the three tables every module-owned database must define:
 *   - merchants
 *   - oauth_tokens
 *   - webhook_log (+ NO indexes — we explicitly do NOT add the dead
 *     `idx_webhook_log_unprocessed` here; see migration 0002_drop_unused_indexes)
 *
 * TODO (D9): once MySQL ships `UUID_v7()` (not present in 9.7), or once we
 * adopt an app-layer UUIDv7 generator (e.g. the `uuidv7` npm package), the
 * `webhook_log.id` column default below should switch from `(UUID())` to a
 * time-ordered generator to give the primary key better B-tree locality and
 * cut insert-side fragmentation. Until then, randomly-ordered UUIDv1 from
 * `UUID()` is the only available option.
 */

import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function createSharedTables(db: Kysely<any>): Promise<void> {
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
}

/**
 * Mirror of `createSharedTables` for `down()` migrations. Order matters:
 * webhook_log and oauth_tokens both FK into merchants, so drop them first.
 */
// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function dropSharedTables(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('webhook_log').ifExists().execute();
  await db.schema.dropTable('oauth_tokens').ifExists().execute();
  await db.schema.dropTable('merchants').ifExists().execute();
}
