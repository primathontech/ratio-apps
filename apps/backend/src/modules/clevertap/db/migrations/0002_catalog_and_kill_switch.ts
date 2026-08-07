import type { Kysely } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('clevertap_configs')
    .addColumn('catalog_name', 'varchar(255)', (c) => c.notNull().defaultTo(''))
    .addColumn('catalog_email', 'varchar(255)', (c) => c.notNull().defaultTo(''))
    .addColumn('catalog_sync_enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('clevertap_enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('clevertap_configs')
    .dropColumn('catalog_name')
    .dropColumn('catalog_email')
    .dropColumn('catalog_sync_enabled')
    .dropColumn('clevertap_enabled')
    .execute();
}
