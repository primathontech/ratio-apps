#!/usr/bin/env tsx
/**
 * Local-only seed: writes one merchant + an ENABLED wizzy_configs row so the
 * storefront can fetch GET /wizzy/sdk/config/<merchantId> with searchEnabled:true.
 * Bypasses the Ratio OAuth install flow. Re-runnable (upserts).
 *
 * Usage (from repo root):
 *   pnpm --filter @ratio-app/backend exec tsx scripts/seed-wizzy-local.ts
 *
 * Real Wizzy creds can be supplied via env without editing this file:
 *   WIZZY_SEED_STORE_ID=... WIZZY_SEED_API_KEY=... pnpm --filter @ratio-app/backend exec tsx scripts/seed-wizzy-local.ts
 */
import { existsSync } from "node:fs";
import * as path from "node:path";
import { config as loadDotenv } from "dotenv";
import { CamelCasePlugin, Kysely, MysqlDialect, sql } from "kysely";
import { createPool } from "mysql2";
import { CryptoService } from "../src/core/crypto/crypto.service";
import type { WizzyDatabase } from "../src/modules/wizzy/db/types";

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
for (const [file, override] of [[".env", false], [".env.local", true]] as const) {
  const found = findUp(file);
  if (found) loadDotenv({ path: found, override });
}

const MERCHANT_ID = "wellversed-local";
const STORE_ID = process.env.WIZZY_SEED_STORE_ID ?? "REPLACE_WITH_WELLVERSED_STORE_ID";
const API_KEY = process.env.WIZZY_SEED_API_KEY ?? "REPLACE_WITH_WELLVERSED_PUBLIC_API_KEY";

async function main(): Promise<void> {
  const dbUrl = process.env.RATIO_WIZZY_DATABASE_URL;
  const encKey = process.env.RATIO_WIZZY_DATA_ENCRYPTION_KEY;
  if (!dbUrl) throw new Error("RATIO_WIZZY_DATABASE_URL is not set");
  if (!encKey) throw new Error("RATIO_WIZZY_DATA_ENCRYPTION_KEY is not set");

  const crypto = new CryptoService(Buffer.from(encKey, "base64"));
  const pool = createPool({ uri: dbUrl, connectionLimit: 1 });
  const db = new Kysely<WizzyDatabase>({
    dialect: new MysqlDialect({ pool }),
    plugins: [new CamelCasePlugin({ maintainNestedObjectKeys: true })],
  });

  try {
    await db
      .insertInto("merchants")
      .values({ id: MERCHANT_ID } as never)
      .onDuplicateKeyUpdate({ id: sql`id` } as never)
      .execute();

    const cols = {
      merchantId: MERCHANT_ID,
      storeId: STORE_ID,
      apiKeyEnc: crypto.encrypt(API_KEY),
      searchEnabled: true,
      inputSelector: "#search",
      resultsMountSelector: "#wizzy-results",
      resultsPagePath: "/pages/search",
      themePrimary: "#2EB4AC",
    };
    await db
      .insertInto("wizzy_configs")
      .values(cols as never)
      .onDuplicateKeyUpdate({
        storeId: cols.storeId,
        apiKeyEnc: cols.apiKeyEnc,
        searchEnabled: cols.searchEnabled,
        inputSelector: cols.inputSelector,
        resultsMountSelector: cols.resultsMountSelector,
        resultsPagePath: cols.resultsPagePath,
        themePrimary: cols.themePrimary,
      } as never)
      .execute();

    console.log(`✓ seeded merchant '${MERCHANT_ID}' (searchEnabled=true)`);
    console.log(`  verify: curl http://localhost:3000/wizzy/sdk/config/${MERCHANT_ID}`);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
