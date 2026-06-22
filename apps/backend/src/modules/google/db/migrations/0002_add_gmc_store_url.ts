/**
 * 0002 — Per-merchant storefront domain for GMC product links.
 *
 * GMC requires every product `link` to live on the SAME domain as the
 * merchant's verified online store (Merchant Center → Business info →
 * verified URL). Without it Google reports "Mismatched online store URL —
 * Prevents from showing", so the product syncs but is never eligible to show.
 *
 * `gmc_store_url` holds that domain (bare host or full URL; the feed mapper
 * normalizes it). NULL = not configured → the sync falls back to the
 * `GMC_STORE_URL` env default, then to a placeholder.
 *
 * Additive only — safe to roll forward on live DBs.
 */
import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE google_configs
      ADD COLUMN gmc_store_url VARCHAR(255) NULL AFTER gmc_merchant_id
  `.execute(db);
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE google_configs DROP COLUMN gmc_store_url`.execute(db);
}
