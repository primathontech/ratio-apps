import { type Kysely, sql } from 'kysely';

// Per-merchant flag mirroring RP's `store_set_up.scriptVisibility` (default true): whether the
// storefront should show the Return/Exchange entry. RP toggles it via POST /rp/config on
// enable/disable; the headless storefront reads it via GET /rp/config?shop=.
// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('return_prime_merchants')
    .addColumn('return_exchange_enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('return_prime_merchants')
    .dropColumn('return_exchange_enabled')
    .execute();
}
