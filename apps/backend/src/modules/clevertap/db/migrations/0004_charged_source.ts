import type { Kysely } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('clevertap_configs')
    .addColumn('charged_source', 'varchar(16)', (c) => c.notNull().defaultTo('server'))
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('clevertap_configs').dropColumn('charged_source').execute();
}
