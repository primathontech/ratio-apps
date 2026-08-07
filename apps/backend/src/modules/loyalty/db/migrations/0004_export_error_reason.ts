import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  // A failed export used to surface in the admin as a bare "failed" tag with
  // no way to tell an unconfigured S3 bucket from an upload error, so the
  // worker now records why.
  await sql`ALTER TABLE loyalty_exports ADD COLUMN error_reason VARCHAR(255) NULL`.execute(db);
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE loyalty_exports DROP COLUMN error_reason`.execute(db);
}
