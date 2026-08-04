#!/usr/bin/env tsx
/**
 * Local-only seed: writes one merchant row so the unicommerce connect flow
 * (POST /unicommerce/admin/credentials/generate) has a valid merchantId to
 * attach credentials to. Bypasses the Ratio OAuth install flow, same as
 * seed-wizzy-local.ts. Re-runnable (upserts).
 *
 * Usage (from repo root):
 *   pnpm --filter @ratio-app/backend exec tsx scripts/seed-unicommerce-local.ts
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Kysely, MysqlDialect, sql } from 'kysely';
import { createPool } from 'mysql2';
import type { UnicommerceDatabase } from '../src/modules/unicommerce/db/types';

function findUp(filename: string): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.resolve(dir, filename);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
for (const [file, override] of [['.env', false], ['.env.local', true]] as const) {
  const found = findUp(file);
  if (found) loadDotenv({ path: found, override });
}

export const MERCHANT_ID = process.env.UC_SEED_MERCHANT_ID ?? 'uc-local-test-merchant';

async function main(): Promise<void> {
  const dbUrl = process.env.RATIO_UNICOMMERCE_DATABASE_URL;
  if (!dbUrl) throw new Error('RATIO_UNICOMMERCE_DATABASE_URL is not set');

  const pool = createPool({ uri: dbUrl, connectionLimit: 1 });
  const db = new Kysely<UnicommerceDatabase>({ dialect: new MysqlDialect({ pool }) });

  try {
    await db
      .insertInto('merchants')
      .values({ id: MERCHANT_ID } as never)
      .onDuplicateKeyUpdate({ id: sql`id` } as never)
      .execute();

    console.log(`seeded merchant '${MERCHANT_ID}'`);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
