/**
 * 0002 — Per-merchant storefront domain for Wizzy product links.
 *
 * Wizzy products carry an absolute `url` so search results link back to the
 * merchant's storefront PDP. `store_url` holds that domain (bare host or full
 * URL; the feed transform normalizes it to `https://<host>/products/<handle>`).
 * NULL = not configured → the product `url` is omitted.
 *
 * Additive only — safe to roll forward on live DBs.
 */
import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE wizzy_configs
      ADD COLUMN store_url VARCHAR(512) NULL AFTER sdk_url
  `.execute(db);
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE wizzy_configs DROP COLUMN store_url`.execute(db);
}
