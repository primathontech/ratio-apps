import type { Kysely } from 'kysely';

// Adds the optional form-level metadata columns that ride alongside the theme:
// `description` (subtitle/heading, max 500) and `redirect_url` (https-only
// redirect-on-submit target, max 2048). Both NULLABLE — existing rows have
// neither and must keep behaving exactly as before. Kept in a NEW migration so
// 0001_initial stays frozen (types.ts is in lockstep with all four).
//
// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('forms').addColumn('description', 'varchar(500)').execute();
  await db.schema.alterTable('forms').addColumn('redirect_url', 'varchar(2048)').execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('forms').dropColumn('redirect_url').execute();
  await db.schema.alterTable('forms').dropColumn('description').execute();
}
