/**
 * 0006 — Per-merchant storefront base URL for catalog/feed product links.
 *
 * The catalog `link` (and feed product URL) must point at the MERCHANT's
 * storefront (e.g. https://sandbox-bblunt-v2.dev.gokwik.io/products/<handle>),
 * not at our app. This is a multi-merchant app, so a single global env
 * (`RATIO_META_STOREFRONT_BASE_URL`) can't be correct for every merchant.
 *
 * `storefront_url` holds the merchant's storefront base (full URL). NULL → fall
 * back to the `RATIO_META_STOREFRONT_BASE_URL` env default, then a placeholder.
 * Mirrors the google app's `gmc_store_url` (migration 0002).
 *
 * Additive only — safe to roll forward on live DBs.
 */
import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE meta_configs
      ADD COLUMN storefront_url VARCHAR(255) NULL AFTER feed_token
  `.execute(db);
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE meta_configs DROP COLUMN storefront_url`.execute(db);
}
