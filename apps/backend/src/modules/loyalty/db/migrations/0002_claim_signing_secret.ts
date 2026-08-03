import { randomBytes } from 'node:crypto';
import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE loyalty_configs ADD COLUMN claim_signing_secret VARCHAR(64) NULL`.execute(db);
  // Backfill existing merchants with a generated secret.
  const rows = await sql<{ merchant_id: string }>`SELECT merchant_id FROM loyalty_configs WHERE claim_signing_secret IS NULL`.execute(db);
  for (const r of rows.rows) {
    const secret = randomBytes(32).toString('base64');
    await sql`UPDATE loyalty_configs SET claim_signing_secret = ${secret} WHERE merchant_id = ${r.merchant_id}`.execute(db);
  }
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE loyalty_configs DROP COLUMN claim_signing_secret`.execute(db);
}
