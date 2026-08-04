#!/usr/bin/env tsx
/**
 * Prove `0001_initial.ts` is LOSSLESS against a production-shaped database.
 *
 * Run this before applying 0001 to production. It:
 *   1. creates a scratch database
 *   2. loads a schema-only dump of the real production FBT database into it
 *   3. seeds one row into each legacy table
 *   4. snapshots every table's columns and row counts
 *   5. runs 0001 IN-PROCESS against the scratch database (see the big comment
 *      below `applyMigration` for why this is not a `pnpm migrate:fbt` subprocess)
 *   6. re-snapshots and asserts: no column disappeared, no column changed type,
 *      no row vanished, and the expected new objects appeared
 *
 * Usage:
 *   mysqldump --no-data -h <prod-host> -u <user> -p <db> > /tmp/fbt-prod-schema.sql
 *   PROD_SCHEMA=/tmp/fbt-prod-schema.sql \
 *   SCRATCH_URL=mysql://app:app@localhost:3306/fbt_verify \
 *     pnpm verify:fbt:additive
 *
 * Must be run via `tsx`, not bare `node` — `FileMigrationProvider` loads
 * `0001_initial.ts` with a dynamic `import()`, and only `tsx`'s loader hook
 * can transpile that TypeScript file on the fly.
 *
 * A schema-only dump is sufficient and deliberate — never copy production rows
 * onto a developer machine.
 */
import { readFileSync, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kysely, MysqlDialect } from 'kysely';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { createPool } from 'mysql2';
import mysql from 'mysql2/promise';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Defaults to the committed production-shaped fixture so this script runs with no
// arguments and can live in CI. Override with a real `mysqldump --no-data` before
// cutover to prove production has not drifted from its own migrations.
const PROD_SCHEMA =
  process.env.PROD_SCHEMA ?? path.resolve(HERE, '../test/fixtures/fbt-production-schema.sql');
const SCRATCH_URL =
  process.env.SCRATCH_URL ?? 'mysql://app:app@localhost:3306/fbt_verify';

console.log(`[verify] schema:  ${PROD_SCHEMA}`);
console.log(`[verify] scratch: ${SCRATCH_URL}`);

const LEGACY_TABLES = [
  'frequently_bought_bundle',
  'merchant_recommendation_config',
  'product_embeddings',
  'product_similarity_cache',
  'bundle_generation_jobs',
  // Not altered by 0001, but present in the fixture and LEFT JOINed by the
  // backfill runbook — its row count deserves the same "nothing vanished"
  // guarantee as the five tables 0001 actually touches.
  'platform_merchants',
];

const EXPECTED_NEW_TABLES = ['merchants', 'oauth_tokens', 'webhook_log', 'fbt_sweep_lease'];

const EXPECTED_NEW_COLUMNS = {
  merchant_recommendation_config: [
    'sync_frequency',
    'sync_hour_utc',
    'sync_weekday',
    'next_run_at',
    'last_run_at',
    'preview_base_url',
  ],
  product_embeddings: ['embedding_blob'],
};

/**
 * Defence in depth. This script unconditionally `DROP DATABASE IF EXISTS`s its
 * target on every run. `SCRATCH_URL` is user/CI-supplied, so a typo, a stale
 * shell export, or an inherited environment variable pointing this at a real
 * database must not be able to destroy it. Require BOTH a `verify` marker in
 * the database name AND a local host — neither alone is a strong enough
 * guarantee (a prod database could be named `fbt_verify_staging`; a local
 * MySQL could have a real database cloned onto it for debugging).
 */
function assertScratchTarget(url) {
  // `mysql:` is not a WHATWG "special" scheme (only http/https/ws/wss/ftp/file
  // are), so the WHATWG URL parser treats its host as OPAQUE: `.hostname` is
  // NOT lowercased the way it would be for `https://LOCALHOST`, and an IPv6
  // literal keeps its brackets (`[::1]` stays `[::1]`, not `::1`). Without
  // normalising both here, `mysql://…@LOCALHOST/fbt_verify` and
  // `mysql://…@[::1]/fbt_verify` would be (wrongly) refused as non-local, and
  // a database literally named `FBT_VERIFY` would be (wrongly) refused as not
  // containing `verify`. These are all fail-CLOSED (reject a valid target,
  // never accept an invalid one), so there's no safety bug — just a confusing
  // false rejection. Do not remove this normalisation as a "simplification";
  // the opaque-host behaviour is genuinely surprising.
  const dbName = url.pathname.replace(/^\//, '').toLowerCase();
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  // `mysql` is the docker-compose service hostname — needed so this script can run
  // from inside the compose network (e.g. CI), not just from the host.
  const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'mysql']);
  if (!dbName.includes('verify')) {
    throw new Error(
      `refusing to DROP/CREATE database '${dbName}': SCRATCH_URL's database name must ` +
        `contain 'verify'. Got: ${url.toString()}`,
    );
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `refusing to DROP/CREATE database '${dbName}' on host '${host}': ` +
        `SCRATCH_URL must point at a local host (localhost / 127.0.0.1 / ::1 / mysql). ` +
        `Got: ${url.toString()}`,
    );
  }
}

/** column name → type, plus row count, for every table in the schema. */
async function snapshot(conn, dbName) {
  const [cols] = await conn.query(
    `SELECT table_name, column_name, column_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = ?
      ORDER BY table_name, column_name`,
    [dbName],
  );
  const [tables] = await conn.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = ?`,
    [dbName],
  );

  const shape = {};
  for (const c of cols) {
    const t = c.TABLE_NAME ?? c.table_name;
    shape[t] ??= {};
    shape[t][c.COLUMN_NAME ?? c.column_name] = {
      type: c.COLUMN_TYPE ?? c.column_type,
      nullable: c.IS_NULLABLE ?? c.is_nullable,
    };
  }

  const counts = {};
  for (const row of tables) {
    const t = row.TABLE_NAME ?? row.table_name;
    const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    counts[t] = Number(n);
  }
  return { shape, counts };
}

/**
 * Applies 0001 to `scratchUrl` IN-PROCESS via Kysely's own `Migrator` +
 * `FileMigrationProvider`, rather than shelling out to `pnpm migrate:fbt`.
 *
 * DO NOT "simplify" this back to `execFileSync('pnpm', [...'migrate.ts', 'fbt'])`.
 * That was the original shape of this script, and it is a live landmine:
 * `scripts/lib/migrate-runner.ts` calls `loadEnvFiles()` — which loads
 * `.env.local` unconditionally and `.env.production` under NODE_ENV=production,
 * BOTH with dotenv's `override: true` — before it reads `RATIO_FBT_DATABASE_URL`
 * from `process.env`. An env var passed to a *child process* is not authoritative:
 * the child's own dotenv load can clobber it. `.env.example` documents
 * `.env.production` as exactly where the real production `RATIO_FBT_DATABASE_URL`
 * lives, so running this verifier from a production-configured shell — which the
 * module header above explicitly asks you to do before cutover — could silently
 * redirect the "scratch" migration onto the live database. Proven empirically:
 * with a `.env.production` present, the child process's resolved URL was NOT
 * `SCRATCH_URL`, it was the production one, even though `SCRATCH_URL` was passed
 * in the child's `env`.
 *
 * Building the Kysely dialect directly from `scratchUrl` in THIS process removes
 * the attack surface entirely: no subprocess, no dotenv load, no env-file that
 * can rewrite the connection string out from under us. The one thing this
 * requires in exchange is that this script itself run under `tsx` (see the
 * module header), since `FileMigrationProvider` loads `0001_initial.ts` via a
 * dynamic `import()` and only `tsx`'s loader can transpile that on the fly.
 */
async function applyMigration(scratchUrl) {
  const migrationFolder = path.resolve(HERE, '../src/modules/fbt/db/migrations');
  const pool = createPool({ uri: scratchUrl, connectionLimit: 1 });
  const db = new Kysely({ dialect: new MysqlDialect({ pool }) });
  try {
    const migrator = new Migrator({
      db,
      provider: new FileMigrationProvider({ fs, path, migrationFolder }),
    });
    const { error, results } = await migrator.migrateToLatest();
    for (const r of results ?? []) {
      if (r.status === 'Success') console.log(`[verify] migrate OK ${r.migrationName}`);
      if (r.status === 'Error') console.error(`[verify] migrate FAIL ${r.migrationName}`);
    }
    if (error) {
      console.error('[verify] migration failed:', error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  } finally {
    await db.destroy();
  }
}

const scratchUrl = new URL(SCRATCH_URL);
assertScratchTarget(scratchUrl);
const dbName = scratchUrl.pathname.replace(/^\//, '');
const adminUrl = new URL(SCRATCH_URL);
adminUrl.pathname = '/';

const admin = await mysql.createConnection({ uri: adminUrl.toString(), multipleStatements: true });
console.log(`[verify] recreating scratch database ${dbName}`);
await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
await admin.query(`CREATE DATABASE \`${dbName}\``);
await admin.end();

const conn = await mysql.createConnection({ uri: SCRATCH_URL, multipleStatements: true });

console.log(`[verify] loading production schema from ${PROD_SCHEMA}`);
await conn.query(readFileSync(PROD_SCHEMA, 'utf8'));

// Every table in LEGACY_TABLES needs at least one row here, or its row-count
// check in section 2 below is vacuous: `before.counts[t] !== after.counts[t]`
// is trivially false when both sides are 0, so a future migration silently
// deleting rows from an unseeded table would pass unnoticed. (This is exactly
// how `platform_merchants` slipped through initially — added to the table
// list and iterated, but never seeded, so its check was 0 !== 0 on every run.)
console.log('[verify] seeding one row per legacy table');
await conn.query(`
  INSERT INTO frequently_bought_bundle
    (id, name, status, scope_type, ui_config, merchant_id, platform, mode)
  VALUES ('b1', 'verify bundle', 'published', 'all_products', '{}', 'verify-merch', 'openstore', 'auto');
`);
await conn.query(`
  INSERT INTO merchant_recommendation_config
    (id, merchant_id, platform, allow_automatic_recommendation, recommendation_count)
  VALUES ('c1', 'verify-merch', 'openstore', 1, 3);
`);
await conn.query(`
  INSERT INTO product_embeddings
    (id, merchant_id, platform, product_id, product_title, embedding_vector)
  VALUES ('e1', 'verify-merch', 'openstore', 'p1', 'verify product', '[0.1,0.2]');
`);
await conn.query(`
  INSERT INTO product_similarity_cache
    (id, merchant_id, platform, source_product_id, similar_products, cache_expires_at)
  VALUES ('s1', 'verify-merch', 'openstore', 'p1', '[]', NOW() + INTERVAL 1 DAY);
`);
await conn.query(`
  INSERT INTO bundle_generation_jobs
    (id, merchant_id, platform, job_type, status)
  VALUES ('j1', 'verify-merch', 'openstore', 'full_sync', 'completed');
`);
await conn.query(`
  INSERT INTO platform_merchants
    (id, merchant_id, platform, shop_domain, access_token, scopes, is_active)
  VALUES ('pm1', 'verify-merch', 'openstore', 'verify.example.com', 'enc', 'read_products', 1);
`);

const before = await snapshot(conn, dbName);
console.log(`[verify] before: ${Object.keys(before.shape).length} tables`);
for (const table of LEGACY_TABLES) {
  console.log(`[verify]   ${table}: ${before.counts[table]} row(s)`);
}

console.log('[verify] running 0001 in-process against the scratch database');
await applyMigration(SCRATCH_URL);

const after = await snapshot(conn, dbName);
await conn.end();

const failures = [];

// 1. No pre-existing column may disappear or change type/nullability.
//    Exception: 0001 deliberately relaxes embedding_vector NOT NULL → NULL.
for (const [table, columns] of Object.entries(before.shape)) {
  for (const [column, def] of Object.entries(columns)) {
    const now = after.shape[table]?.[column];
    if (!now) {
      failures.push(`column DISAPPEARED: ${table}.${column}`);
      continue;
    }
    if (now.type !== def.type) {
      failures.push(`column TYPE CHANGED: ${table}.${column}: ${def.type} → ${now.type}`);
    }
    const relaxedOnPurpose =
      table === 'product_embeddings' &&
      column === 'embedding_vector' &&
      def.nullable === 'NO' &&
      now.nullable === 'YES';
    if (now.nullable !== def.nullable && !relaxedOnPurpose) {
      failures.push(
        `column NULLABILITY CHANGED: ${table}.${column}: ${def.nullable} → ${now.nullable}`,
      );
    }
  }
}

// 2. No row may vanish from a legacy table.
for (const table of LEGACY_TABLES) {
  if (before.counts[table] !== after.counts[table]) {
    failures.push(
      `ROW COUNT CHANGED: ${table}: ${before.counts[table]} → ${after.counts[table]}`,
    );
  }
}

// 3. The expected new objects must exist.
for (const table of EXPECTED_NEW_TABLES) {
  if (!after.shape[table]) failures.push(`expected new table MISSING: ${table}`);
}
for (const [table, columns] of Object.entries(EXPECTED_NEW_COLUMNS)) {
  for (const column of columns) {
    if (!after.shape[table]?.[column]) {
      failures.push(`expected new column MISSING: ${table}.${column}`);
    }
  }
}

// 4. The lease row must be seeded and already expired, so the first acquire wins.
if (!after.shape.fbt_sweep_lease) {
  failures.push('fbt_sweep_lease missing — cannot check seed row');
} else if (after.counts.fbt_sweep_lease !== 1) {
  failures.push(`fbt_sweep_lease should hold exactly 1 row, found ${after.counts.fbt_sweep_lease}`);
}

if (failures.length > 0) {
  console.error('\n[verify] FAILED — 0001 is NOT additive:\n');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

console.log('\n[verify] PASSED — 0001 is additive and lossless.');
console.log(`  tables before: ${Object.keys(before.shape).length}`);
console.log(`  tables after:  ${Object.keys(after.shape).length}`);
console.log(`  new tables:    ${EXPECTED_NEW_TABLES.join(', ')}`);
