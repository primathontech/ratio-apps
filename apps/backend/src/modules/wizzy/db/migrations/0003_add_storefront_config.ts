/**
 * 0003 — Per-merchant storefront search SDK settings for Wizzy.
 *
 * The storefront search SDK is configured per merchant: a master switch
 * (`search_enabled`), the CSS selectors for the search input and results
 * mount point, the results page path, and the primary theme color. These
 * are plain (non-secret) values echoed back to the admin and injected into
 * the storefront SDK bootstrap.
 *
 * Additive only — safe to roll forward on live DBs.
 */
import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE wizzy_configs
      ADD COLUMN search_enabled TINYINT(1) NOT NULL DEFAULT 0,
      ADD COLUMN input_selector VARCHAR(255) NOT NULL DEFAULT '#search',
      ADD COLUMN results_mount_selector VARCHAR(255) NOT NULL DEFAULT '#wizzy-results',
      ADD COLUMN results_page_path VARCHAR(255) NOT NULL DEFAULT '/search',
      ADD COLUMN theme_primary VARCHAR(32) NOT NULL DEFAULT '#0fb3a9'
  `.execute(db);
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE wizzy_configs
      DROP COLUMN search_enabled,
      DROP COLUMN input_selector,
      DROP COLUMN results_mount_selector,
      DROP COLUMN results_page_path,
      DROP COLUMN theme_primary
  `.execute(db);
}
