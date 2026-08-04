#!/usr/bin/env node
/**
 * Prove `0001_initial.ts` is LOSSLESS against a production-shaped database.
 *
 * Run this before applying 0001 to production. It:
 *   1. creates a scratch database
 *   2. loads a schema-only dump of the real production FBT database into it
 *   3. seeds one row into each legacy table
 *   4. snapshots every table's columns and row counts
 *   5. runs `migrate:fbt` against the scratch database
 *   6. re-snapshots and asserts: no column disappeared, no column changed type,
 *      no row vanished, and the expected new objects appeared
 *
 * Usage:
 *   mysqldump --no-data -h <prod-host> -u <user> -p <db> > /tmp/fbt-prod-schema.sql
 *   PROD_SCHEMA=/tmp/fbt-prod-schema.sql \
 *   SCRATCH_URL=mysql://app:app@localhost:3306/fbt_verify \
 *     pnpm verify:fbt:additive
 *
 * A schema-only dump is sufficient and deliberate — never copy production rows
 * onto a developer machine.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// Defaults to the committed production-shaped fixture so this script runs with no
// arguments and can live in CI. Override with a real `mysqldump --no-data` before
// cutover to prove production has not drifted from its own migrations.
const PROD_SCHEMA =
  process.env.PROD_SCHEMA ?? resolve(HERE, '../test/fixtures/fbt-production-schema.sql');
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

const url = new URL(SCRATCH_URL);
const dbName = url.pathname.replace(/^\//, '');
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

const before = await snapshot(conn, dbName);
console.log(`[verify] before: ${Object.keys(before.shape).length} tables`);

console.log('[verify] running migrate:fbt against the scratch database');
execFileSync('pnpm', ['--filter', '@ratio-app/backend', 'exec', 'tsx', 'scripts/migrate.ts', 'fbt'], {
  stdio: 'inherit',
  env: { ...process.env, RATIO_FBT_DATABASE_URL: SCRATCH_URL },
});

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
