/**
 * 0001 — FBT initial migration. ADDITIVE ONLY.
 *
 * This module reuses the EXISTING FBT production database rather than creating a
 * fresh `fbt_app` schema. While the old backend is still serving live merchants,
 * both backends run against this one database — so nothing here may drop,
 * rename, or tighten an existing object. `test/unit/apps/fbt/migration-additive.test.ts`
 * enforces that mechanically. Destructive cleanup lives in 0002, post-cutover.
 *
 * What this does:
 *   1. creates the three shared tables (none exist in the FBT DB today)
 *   2. adds scheduling columns to `merchant_recommendation_config`, replacing the
 *      ACTIVE_MERCHANTS / FULL_SYNC_CRON env vars with per-merchant DB state
 *   3. creates `fbt_sweep_lease` (single-runner lease for the sweep)
 *   4. adds `product_embeddings.embedding_blob` and RELAXES `embedding_vector`
 *      to NULL so a blob-only insert is legal
 *
 * Local/CI runs this against an empty `fbt_app` / `fbt_app_test`, where steps
 * 2 and 4 have no tables to alter — hence `tableExists` guards, which also make
 * the migration idempotent-ish against a partially-migrated database.
 */
import { type Kysely, sql } from 'kysely';
import { createSharedTables, dropSharedTables } from '../../../../core/db/shared-migrations';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
async function tableExists(db: Kysely<any>, table: string): Promise<boolean> {
  const result = await sql<{ n: number }>`
    SELECT COUNT(*) AS n
      FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ${table}
  `.execute(db);
  return Number(result.rows[0]?.n ?? 0) > 0;
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
async function columnExists(db: Kysely<any>, table: string, column: string): Promise<boolean> {
  const result = await sql<{ n: number }>`
    SELECT COUNT(*) AS n
      FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ${table} AND column_name = ${column}
  `.execute(db);
  return Number(result.rows[0]?.n ?? 0) > 0;
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
async function indexExists(db: Kysely<any>, table: string, index: string): Promise<boolean> {
  const result = await sql<{ n: number }>`
    SELECT COUNT(*) AS n
      FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ${table} AND index_name = ${index}
  `.execute(db);
  return Number(result.rows[0]?.n ?? 0) > 0;
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  // ── 1. shared tables ────────────────────────────────────────────────────
  // merchants / oauth_tokens / webhook_log. None exist in the FBT database, so
  // this is a pure CREATE. createSharedTables deliberately has no
  // .ifNotExists() — if that assumption is ever wrong, we want a loud failure.
  await createSharedTables(db);

  // ── 2. per-merchant scheduling on merchant_recommendation_config ────────
  // All nullable or defaulted ⇒ online ALTER, invisible to the running old
  // backend. This is what replaces ACTIVE_MERCHANTS + FULL_SYNC_CRON.
  if (await tableExists(db, 'merchant_recommendation_config')) {
    const additions: Array<[string, () => Promise<unknown>]> = [
      [
        'sync_frequency',
        () =>
          db.schema
            .alterTable('merchant_recommendation_config')
            .addColumn('sync_frequency', sql`enum('daily','weekly')`, (c) =>
              c.notNull().defaultTo('daily'),
            )
            .execute(),
      ],
      [
        'sync_hour_utc',
        () =>
          db.schema
            .alterTable('merchant_recommendation_config')
            // 'tinyint' isn't in Kysely's built-in ColumnDataType union (MySQL-specific
            // width variant), so it must go through the sql tag like sync_frequency's
            // enum(...) below — same DDL, just a type Kysely will accept.
            .addColumn('sync_hour_utc', sql`tinyint`, (c) => c.notNull().defaultTo(4))
            .execute(),
      ],
      [
        'sync_weekday',
        () =>
          db.schema
            .alterTable('merchant_recommendation_config')
            .addColumn('sync_weekday', sql`tinyint`)
            .execute(),
      ],
      [
        'next_run_at',
        () =>
          db.schema
            .alterTable('merchant_recommendation_config')
            .addColumn('next_run_at', 'datetime(3)')
            .execute(),
      ],
      [
        'last_run_at',
        () =>
          db.schema
            .alterTable('merchant_recommendation_config')
            .addColumn('last_run_at', 'datetime(3)')
            .execute(),
      ],
      [
        'preview_base_url',
        () =>
          db.schema
            .alterTable('merchant_recommendation_config')
            .addColumn('preview_base_url', 'varchar(255)')
            .execute(),
      ],
    ];
    for (const [column, add] of additions) {
      if (!(await columnExists(db, 'merchant_recommendation_config', column))) {
        await add();
      }
    }

    // Drives the sweep's due-selection query. MySQL has no
    // CREATE INDEX IF NOT EXISTS, so probe information_schema rather than
    // swallowing errors from the CREATE — a blanket .catch() would also hide a
    // genuine failure (bad column, insufficient privilege, disk full).
    if (!(await indexExists(db, 'merchant_recommendation_config', 'idx_mrc_next_run_at'))) {
      await sql`
        CREATE INDEX idx_mrc_next_run_at ON merchant_recommendation_config (next_run_at)
      `.execute(db);
    }
  }

  // ── 3. sweep lease ──────────────────────────────────────────────────────
  // Row lease rather than MySQL GET_LOCK: GET_LOCK is scoped to a CONNECTION,
  // and Kysely hands out pooled connections, so a release can land on a
  // different connection than the acquire and leak the lock. A row lease is
  // atomic, connection-independent, and self-heals on expiry.
  if (!(await tableExists(db, 'fbt_sweep_lease'))) {
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
      ON DUPLICATE KEY UPDATE lease_key = lease_key
    `.execute(db);
  }

  // ── 4. embedding storage ────────────────────────────────────────────────
  if (await tableExists(db, 'product_embeddings')) {
    if (!(await columnExists(db, 'product_embeddings', 'embedding_blob'))) {
      await db.schema
        .alterTable('product_embeddings')
        .addColumn('embedding_blob', 'blob')
        .execute();
    }
    // REQUIRED, not cosmetic: embedding_vector is NOT NULL today, so the new
    // module's blob-only insert would fail without this. Relaxing NOT NULL is
    // backward-compatible in the direction that matters — the old ABS always
    // writes a value, so it never observes a NULL in a row it produced, and by
    // the time this module writes anything the old ABS is stopped.
    await sql`
      ALTER TABLE product_embeddings MODIFY COLUMN embedding_vector JSON NULL
    `.execute(db);
  }
}

/**
 * Local/CI rollback only. In production, `0001` is never rolled back — the
 * cleanup path is `0002`. `migrate-down.ts` already refuses to roll back a
 * migration matching /initial/ without `--yes-i-know-this-drops-tables`.
 *
 * Only reverses what `up` created. It does NOT re-tighten `embedding_vector`
 * to NOT NULL: any row this module wrote has a NULL there, so re-adding the
 * constraint would fail. Leaving it nullable is the safe asymmetry.
 */
// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  if (await tableExists(db, 'product_embeddings')) {
    if (await columnExists(db, 'product_embeddings', 'embedding_blob')) {
      await db.schema.alterTable('product_embeddings').dropColumn('embedding_blob').execute();
    }
  }

  await db.schema.dropTable('fbt_sweep_lease').ifExists().execute();

  if (await tableExists(db, 'merchant_recommendation_config')) {
    if (await indexExists(db, 'merchant_recommendation_config', 'idx_mrc_next_run_at')) {
      await sql`DROP INDEX idx_mrc_next_run_at ON merchant_recommendation_config`.execute(db);
    }
    for (const column of [
      'preview_base_url',
      'last_run_at',
      'next_run_at',
      'sync_weekday',
      'sync_hour_utc',
      'sync_frequency',
    ]) {
      if (await columnExists(db, 'merchant_recommendation_config', column)) {
        await db.schema
          .alterTable('merchant_recommendation_config')
          .dropColumn(column)
          .execute();
      }
    }
  }

  await dropSharedTables(db);
}
