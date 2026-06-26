#!/usr/bin/env tsx
/**
 * One-off repair for the Google feed audit log.
 *
 *   1. Drops the merchants FK from google_feed_events if it's still there
 *      (idempotent — safe if 0004 already ran).
 *   2. Backfills a "first observation" history row for every current feed item
 *      that has no event yet, so "Status change history" reflects today's state
 *      instead of staying empty until each product next changes.
 *
 * Run once:  tsx scripts/repair-feed-events.ts google
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { createPool } from 'mysql2/promise';

function loadEnv(): void {
  const find = (f: string): string | null => {
    let dir = process.cwd();
    for (let i = 0; i < 6; i++) {
      const c = path.resolve(dir, f);
      if (existsSync(c)) return c;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  };
  const sources: Array<readonly [string, boolean]> = [['.env', false], ['.env.local', true]];
  if (process.env.NODE_ENV === 'production') sources.push(['.env.production', true]);
  for (const [f, o] of sources) {
    const p = find(f);
    if (p) loadDotenv({ path: p, override: o });
  }
}

async function main(): Promise<void> {
  loadEnv();
  const slug = process.argv[2] ?? 'google';
  const url = process.env[`RATIO_${slug.toUpperCase()}_DATABASE_URL`];
  if (!url) {
    console.error(`RATIO_${slug.toUpperCase()}_DATABASE_URL not set`);
    process.exit(1);
  }
  const pool = createPool({ uri: url, connectionLimit: 1 });
  const q = async (sql: string): Promise<Record<string, unknown>[]> => {
    const [r] = await pool.query(sql);
    return r as Record<string, unknown>[];
  };
  try {
    const before = await q(
      'SELECT (SELECT COUNT(*) FROM google_feed_items) AS items, (SELECT COUNT(*) FROM google_feed_events) AS events',
    );
    console.log(`before: items=${before[0]?.items} events=${before[0]?.events}`);

    // 1. Drop the FK if present.
    const fk = await q(
      "SELECT CONSTRAINT_NAME AS n FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'google_feed_events' AND CONSTRAINT_TYPE = 'FOREIGN KEY'",
    );
    if (fk.length === 0) {
      console.log('FK: already absent — nothing to drop.');
    } else {
      for (const row of fk) {
        await q(`ALTER TABLE google_feed_events DROP FOREIGN KEY \`${String(row.n)}\``);
        console.log(`FK: dropped ${row.n}`);
      }
    }

    // 2. Backfill first-observation events for items that have none yet.
    const [res] = (await pool.query(
      `INSERT INTO google_feed_events
         (merchant_id, offer_id, product_id, variant_id, title, status, previous_status, issue, sync_type, created_at)
       SELECT fi.merchant_id, fi.offer_id, fi.product_id, fi.variant_id, fi.title, fi.status, NULL, fi.issue, 'reconcile', fi.updated_at
       FROM google_feed_items fi
       WHERE NOT EXISTS (
         SELECT 1 FROM google_feed_events fe
         WHERE fe.merchant_id = fi.merchant_id AND fe.offer_id = fi.offer_id
       )`,
    )) as unknown as [{ affectedRows: number }, unknown];
    console.log(`backfill: inserted ${res.affectedRows} first-observation event(s)`);

    const after = await q('SELECT COUNT(*) AS c FROM google_feed_events');
    console.log(`after: events=${after[0]?.c}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
