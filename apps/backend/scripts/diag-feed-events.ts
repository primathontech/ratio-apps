#!/usr/bin/env tsx
/**
 * READ-ONLY diagnostic for the Google feed audit log.
 *
 * Usage: tsx scripts/diag-feed-events.ts google
 *
 * Prints whether google_feed_events exists, row counts for items vs events,
 * per-merchant breakdown, and the most recent events — to explain an empty
 * "Status change history" panel. Touches nothing; SELECT-only.
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { createPool } from 'mysql2/promise';

function loadEnvFiles(): void {
  const find = (filename: string): string | null => {
    let dir = process.cwd();
    for (let i = 0; i < 6; i++) {
      const candidate = path.resolve(dir, filename);
      if (existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  };
  const sources: Array<readonly [string, boolean]> = [
    ['.env', false],
    ['.env.local', true],
  ];
  if (process.env.NODE_ENV === 'production') sources.push(['.env.production', true]);
  for (const [file, override] of sources) {
    const found = find(file);
    if (found) {
      loadDotenv({ path: found, override });
      console.log(`[diag] loaded env from ${found}${override ? ' (override)' : ''}`);
    }
  }
}

async function main(): Promise<void> {
  loadEnvFiles();
  const slug = process.argv[2] ?? 'google';
  const url = process.env[`RATIO_${slug.toUpperCase()}_DATABASE_URL`];
  if (!url) {
    console.error(`[diag] RATIO_${slug.toUpperCase()}_DATABASE_URL not set`);
    process.exit(1);
  }
  const pool = createPool({ uri: url, connectionLimit: 1 });
  const q = async (sql: string): Promise<Record<string, unknown>[]> => {
    const [rows] = await pool.query(sql);
    return rows as Record<string, unknown>[];
  };
  try {
    const db = (await q('SELECT DATABASE() AS db'))[0]?.db;
    console.log(`\n=== database: ${db} ===`);

    const tables = await q("SHOW TABLES LIKE 'google_feed%'");
    console.log('feed tables present:', tables.map((t) => Object.values(t)[0]).join(', ') || '(none)');

    const eventsExists = tables.some((t) => String(Object.values(t)[0]) === 'google_feed_events');

    const items = await q('SELECT COUNT(*) AS c FROM google_feed_items');
    console.log(`\ngoogle_feed_items rows: ${items[0]?.c}`);
    console.table(await q('SELECT merchant_id, status, COUNT(*) AS n FROM google_feed_items GROUP BY merchant_id, status ORDER BY merchant_id, status'));

    if (!eventsExists) {
      console.log('\n>>> google_feed_events does NOT exist — migration 0003 not applied here.');
      return;
    }

    const events = await q('SELECT COUNT(*) AS c FROM google_feed_events');
    console.log(`\ngoogle_feed_events rows: ${events[0]?.c}`);
    console.table(await q('SELECT merchant_id, COUNT(*) AS n FROM google_feed_events GROUP BY merchant_id'));
    console.log('\nmost recent 10 events:');
    console.table(
      await q(
        'SELECT id, merchant_id, offer_id, previous_status, status, sync_type, created_at FROM google_feed_events ORDER BY id DESC LIMIT 10',
      ),
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
