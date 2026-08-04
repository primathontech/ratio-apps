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
  // on a first run this is a pure CREATE.
  //
  // `createSharedTables` deliberately has no `.ifNotExists()` — it is designed to
  // fail loudly on stale state, and that design is right for the eight other
  // vendors. But it is the FIRST statement here while every other mutation below
  // is `information_schema`-guarded so a retry can resume. Unguarded, a failure in
  // ANY later step would leave Kysely with no recorded migration, and the next
  // `migrate:fbt` would re-enter from the top, hit `CREATE TABLE merchants`, and
  // die before reaching the guards that exist precisely to let it resume — forcing
  // a human to drop three tables by hand mid-cutover.
  //
  // So gate it HERE, in this migration, and leave `core/db/shared-migrations.ts`
  // untouched: the other vendors keep the loud-failure behaviour.
  //
  // Check all THREE tables, not just `merchants`. `createSharedTables` creates them
  // sequentially with separate awaits and MySQL DDL is not transactional, so a crash
  // between them is possible. Gating on `merchants` alone would then skip creation
  // forever on retry, `up()` would run to completion, Kysely would mark 0001 applied
  // permanently, and `oauth_tokens` / `webhook_log` would silently never exist —
  // surfacing much later as runtime "table doesn't exist" errors. That is strictly
  // worse than the unguarded original, which at least failed loudly. So: all three
  // absent → create; all three present → skip (the resumable path we want); a
  // PARTIAL state → refuse, loudly, with the exact recovery command.
  const SHARED_TABLES = ['merchants', 'oauth_tokens', 'webhook_log'] as const;
  const present: string[] = [];
  for (const table of SHARED_TABLES) {
    if (await tableExists(db, table)) present.push(table);
  }
  if (present.length === 0) {
    await createSharedTables(db);
  } else if (present.length < SHARED_TABLES.length) {
    const missing = SHARED_TABLES.filter((t) => !present.includes(t));
    throw new Error(
      `fbt 0001: shared tables are PARTIALLY present — ${present.join(', ')} exist, ` +
        `${missing.join(', ')} missing. A previous run died inside createSharedTables. ` +
        `This migration will not guess at a half-built schema. Drop what exists and re-run:\n` +
        `  DROP TABLE ${[...present].reverse().join(', ')};`,
    );
  }

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
            // `sql`tinyint`` not `'tinyint'`: Kysely's ColumnDataType union has no
            // 'tinyint' member (it is MySQL-specific), so the string literal fails
            // `tsc --noEmit`. Same escape hatch as the enum column above.
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
    // backward-compatible — the old ABS always writes a value, so it never
    // observes a NULL in a row it produced.
    //
    // MySQL has no "alter nullability only" syntax: MODIFY COLUMN requires the
    // full column definition restated. Hardcoding `JSON` would therefore ASSERT
    // the production column's type, and silently RETYPE it if that assumption is
    // wrong (e.g. if production has LONGTEXT) — a data-affecting side effect
    // smuggled in under a nullability change, which no guard in this file would
    // catch. So read the live type from information_schema and restate exactly
    // that, changing only nullability. Nothing here is user input; the value is
    // the database's own metadata.
    //
    // Skipped entirely when the column is already nullable, so a retry is a no-op.
    const vectorCol = await sql<{ columnType: string; isNullable: string }>`
      SELECT COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable
        FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'product_embeddings'
         AND column_name = 'embedding_vector'
    `.execute(db);
    const vector = vectorCol.rows[0];
    if (vector && vector.isNullable === 'NO') {
      // `MODIFY COLUMN` restates the WHOLE definition, so any attribute not repeated
      // is dropped — CHARACTER SET / COLLATE / DEFAULT / COMMENT / generated-column
      // expression. `COLUMN_TYPE` carries none of those.
      //
      // For THIS column that is provably harmless: the source repo creates it as
      // `embedding_vector json NOT NULL` (osapp-freq-bought migration
      // 1704067700000-CreateEmbeddingTables.ts:15) and no later migration touches
      // product_embeddings. MySQL JSON columns cannot carry CHARACTER SET or COLLATE
      // at all, and this one has no default, comment, or generation expression.
      //
      // The residual risk is schema DRIFT — someone having hand-altered production
      // away from its own migration. We cannot verify that from here, so assert
      // instead of assuming: if the live type is anything but `json`, stop loudly
      // rather than silently restating a definition that may lose attributes.
      if (vector.columnType.toLowerCase() !== 'json') {
        throw new Error(
          `fbt 0001: product_embeddings.embedding_vector is '${vector.columnType}', expected 'json'. ` +
            `Production has drifted from its creating migration. MODIFY COLUMN restates the full ` +
            `definition, so relaxing nullability on a non-JSON type could silently drop CHARACTER SET, ` +
            `COLLATE, DEFAULT or COMMENT. Inspect the live column and relax it by hand:\n` +
            `  SHOW CREATE TABLE product_embeddings;\n` +
            `then re-issue that exact column definition with NOT NULL removed.`,
        );
      }
      await sql`
        ALTER TABLE product_embeddings
        MODIFY COLUMN embedding_vector ${sql.raw(vector.columnType)} NULL
      `.execute(db);
    }
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
