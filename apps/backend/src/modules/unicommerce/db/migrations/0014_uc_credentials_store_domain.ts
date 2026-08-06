/**
 * 0014 — Add a nullable `store_domain` column to `uc_credentials`.
 *
 * The storefront domain used to build each product's `productUrl` in the
 * catalog pull (`GET /products`) was a single global env var
 * (`RATIO_UNICOMMERCE_STOREFRONT_DOMAIN`) baked into a singleton service, so
 * every merchant on a shared deployment got the SAME domain — wrong for every
 * merchant except possibly one. This column captures each merchant's REAL
 * storefront domain, captured at OAuth install time from the token response's
 * `merchantStoreId` (or the access-token JWT) and read back per-merchant when
 * building `productUrl`.
 *
 * Nullable, no default: merchants who installed BEFORE this migration have no
 * stored value and keep using the global env var as a fallback until they
 * re-install (or a future backfill). Only re-install time can populate this,
 * since the domain comes from the OAuth token exchange response.
 */
import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('uc_credentials').addColumn('store_domain', 'varchar(255)').execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE uc_credentials DROP COLUMN store_domain`.execute(db);
}
