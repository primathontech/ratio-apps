#!/usr/bin/env tsx
/**
 * Local-only seed: writes one merchant + a fully-configured `clevertap_configs`
 * row so the app is demoable WITHOUT the Ratio OAuth install flow, without a
 * registered developer app, and without a UAT merchant. Re-runnable (upserts).
 *
 * Mirrors `seed-wizzy-local.ts`. The merchant-token guard resolves the merchant
 * from `Authorization: Bearer <merchantId>` or `X-Merchant-Id: <merchantId>` and
 * just looks the row up — so a seeded row is all the admin needs.
 *
 * Usage (from repo root):
 *   pnpm --filter @ratio-app/backend exec tsx scripts/seed-clevertap-local.ts
 *
 * Supply REAL CleverTap credentials via env so events actually land in your
 * dashboard (Project ID is the Account ID; the Passcode is Settings → Passcodes.
 * NOT the Project Token — that is a different credential and will 401):
 *   CLEVERTAP_SEED_ACCOUNT_ID=W6R-88W-9W5Z \
 *   CLEVERTAP_SEED_PASSCODE=xxxxxxxx \
 *   CLEVERTAP_SEED_REGION=in1 \
 *   pnpm --filter @ratio-app/backend exec tsx scripts/seed-clevertap-local.ts
 *
 * Without those it still seeds a usable row, but `serverEventsEnabled` stays
 * false (no passcode ⇒ forwarding correctly refuses to be enabled) so only the
 * pixel path is demoable.
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { CLEVERTAP_REGIONS } from '@ratio-app/shared/constants/clevertap-events';
import { buildDefaultEventMap } from '@ratio-app/shared/schemas/event-map';
import { config as loadDotenv } from 'dotenv';
import { CamelCasePlugin, Kysely, MysqlDialect, sql } from 'kysely';
import { createPool } from 'mysql2';
import { CryptoService } from '../src/core/crypto/crypto.service';
import type { ClevertapDatabase } from '../src/modules/clevertap/db/types';

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
for (const [file, override] of [
  ['.env', false],
  ['.env.local', true],
] as const) {
  const found = findUp(file);
  if (found) loadDotenv({ path: found, override });
}

const MERCHANT_ID = process.env.CLEVERTAP_SEED_MERCHANT_ID ?? 'dev-merchant';
const ACCOUNT_ID = process.env.CLEVERTAP_SEED_ACCOUNT_ID ?? '';
const PASSCODE = process.env.CLEVERTAP_SEED_PASSCODE ?? '';
const REGION = process.env.CLEVERTAP_SEED_REGION ?? 'in1';

async function main(): Promise<void> {
  const dbUrl = process.env.RATIO_CLEVERTAP_DATABASE_URL;
  const encKey = process.env.RATIO_CLEVERTAP_DATA_ENCRYPTION_KEY;
  if (!dbUrl) throw new Error('RATIO_CLEVERTAP_DATABASE_URL is not set');
  if (!encKey) throw new Error('RATIO_CLEVERTAP_DATA_ENCRYPTION_KEY is not set');
  if (!(REGION in CLEVERTAP_REGIONS)) {
    throw new Error(
      `CLEVERTAP_SEED_REGION='${REGION}' is not a known region. One of: ${Object.keys(CLEVERTAP_REGIONS).join(', ')}`,
    );
  }

  const crypto = new CryptoService(Buffer.from(encKey, 'base64'));
  const pool = createPool({ uri: dbUrl, connectionLimit: 1 });
  const db = new Kysely<ClevertapDatabase>({
    dialect: new MysqlDialect({ pool }),
    plugins: [new CamelCasePlugin({ maintainNestedObjectKeys: true })],
  });

  try {
    await db
      .insertInto('merchants')
      .values({ id: MERCHANT_ID } as never)
      .onDuplicateKeyUpdate({ id: sql`id` } as never)
      .execute();

    // Server-side forwarding requires a stored passcode — the config service
    // refuses the enabled-without-credential combination, so mirror that here.
    const serverEventsEnabled = Boolean(ACCOUNT_ID && PASSCODE);

    const cols = {
      merchantId: MERCHANT_ID,
      accountId: ACCOUNT_ID,
      region: REGION,
      serverEventsEnabled,
      debug: true, // verbose pixel logging — this is a demo/dev seed
      // mysql2 does NOT auto-serialize objects into JSON columns.
      events: JSON.stringify(buildDefaultEventMap('clevertap')),
      ...(PASSCODE ? { passcodeEnc: crypto.encrypt(PASSCODE) } : {}),
    };

    await db
      .insertInto('clevertap_configs')
      .values(cols as never)
      .onDuplicateKeyUpdate(cols as never)
      .execute();

    const host = CLEVERTAP_REGIONS[REGION as keyof typeof CLEVERTAP_REGIONS];
    console.log(`✓ seeded merchant '${MERCHANT_ID}'`);
    console.log(`    accountId  : ${ACCOUNT_ID || '(empty — pixel will 404 CONFIG_INCOMPLETE)'}`);
    console.log(`    region     : ${REGION} → ${host.apiHost}`);
    console.log(`    passcode   : ${PASSCODE ? 'stored (encrypted)' : '(none)'}`);
    console.log(`    serverEvents: ${serverEventsEnabled ? 'ENABLED' : 'disabled (no passcode)'}`);
    console.log('');
    console.log('  verify the pixel:');
    console.log(`    curl -s http://localhost:3000/clevertap/sdk/${MERCHANT_ID}.js | head -1`);
    console.log('  open the admin:');
    console.log(`    http://localhost:5173/?merchant-id=${MERCHANT_ID}`);
    if (serverEventsEnabled) {
      console.log('  fire a synthetic orders/paid (NODE_ENV!=production ⇒ no signature needed):');
      console.log(
        `    curl -X POST http://localhost:3000/clevertap/api/v1/oauth/webhook \\\n` +
          `      -H 'content-type: application/json' \\\n` +
          `      -d '{"event_type":"orders/paid","merchant_id":"${MERCHANT_ID}","order":{"id":1001,"total_price":149900,"currency":"INR","line_items":[{"id":1,"title":"Demo Product","quantity":2,"price":74950}],"customer":{"phone":"+919876543210","email":"demo@example.com"}}}'`,
      );
      console.log(`  then check Charged in ${host.dashboard}`);
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
