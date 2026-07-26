import type { Kysely } from 'kysely';

// Adds the optional `context_json` column to `form_submissions`: hidden-field
// provenance (field key → { source, raw value }) captured at submit time (§4).
// NULLABLE — existing rows have no context and must keep behaving exactly as
// before, and a submission with no hidden fields writes null. Kept in a NEW
// migration so 0001_initial stays frozen (types.ts is in lockstep with all
// five). JSON column, mirroring `data_json` / `files_json`.
//
// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('form_submissions').addColumn('context_json', 'json').execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('form_submissions').dropColumn('context_json').execute();
}
