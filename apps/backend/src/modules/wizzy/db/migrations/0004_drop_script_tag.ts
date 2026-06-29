/**
 * 0004 — Remove legacy ScriptTag SDK-registration columns from wizzy_configs.
 *
 * The ScriptTag auto-injection subsystem was a `pending_api` placeholder and
 * has been fully replaced by the storefront-search SDK served at /wizzy/sdk/*.
 * These three columns are no longer read or written anywhere.
 *
 * Destructive — not safe to roll back without data loss on live DBs.
 */
import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('wizzy_configs').dropColumn('sdk_url').execute();
  await db.schema.alterTable('wizzy_configs').dropColumn('script_tag_id').execute();
  await db.schema.alterTable('wizzy_configs').dropColumn('script_tag_status').execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE wizzy_configs
      ADD COLUMN sdk_url VARCHAR(512) NOT NULL DEFAULT 'https://cdn.wizzy.ai/sdk/v2/wizzy.min.js'
  `.execute(db);
  await sql`
    ALTER TABLE wizzy_configs
      ADD COLUMN script_tag_id VARCHAR(128) NULL
  `.execute(db);
  await sql`
    ALTER TABLE wizzy_configs
      ADD COLUMN script_tag_status ENUM('active','pending_api','error','disabled') NOT NULL DEFAULT 'disabled'
  `.execute(db);
}
