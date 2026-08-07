import type { Kysely } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('clevertap_configs')
    .addColumn('last_catalog_sync_at', 'datetime(3)')
    .addColumn('last_catalog_sync_status', 'varchar(16)')
    .addColumn('last_catalog_sync_count', 'integer')
    .addColumn('last_catalog_sync_error', 'varchar(512)')
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('clevertap_configs')
    .dropColumn('last_catalog_sync_at')
    .dropColumn('last_catalog_sync_status')
    .dropColumn('last_catalog_sync_count')
    .dropColumn('last_catalog_sync_error')
    .execute();
}
