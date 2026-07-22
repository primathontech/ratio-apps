import type { Kysely } from 'kysely';

// Adds the theme/appearance column to forms. Kept in a NEW migration so
// 0001_initial stays frozen (types.ts is in lockstep with all three).
//
// appearance_json mirrors schema_json (0001:107) but is NULLABLE: existing
// rows have no appearance and must keep rendering with the SDK's baked-in
// defaults, so an un-themed form stays visually unchanged.
//
// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('forms').addColumn('appearance_json', 'json').execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('forms').dropColumn('appearance_json').execute();
}
