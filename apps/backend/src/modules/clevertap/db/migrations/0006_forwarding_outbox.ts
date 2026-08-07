import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('clevertap_forwarded_events')
    .addColumn('payload', 'json')
    .addColumn('claimed_at', sql`datetime(3)`)
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('clevertap_forwarded_events')
    .dropColumn('claimed_at')
    .dropColumn('payload')
    .execute();
}
