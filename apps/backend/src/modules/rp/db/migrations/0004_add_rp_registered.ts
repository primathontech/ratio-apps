import type { Kysely } from 'kysely';

// Explicit "did RP actually confirm this merchant" flag — separate from `domain`.
// Registration previously updated `domain` unconditionally before calling RP's
// os-install, and RpAdminController.me() inferred `registered` from
// `domain !== merchantId`. If os-install then failed, the domain update had
// already been persisted, so a page refresh showed "Return Prime configured!"
// even though RP never confirmed anything. `rp_registered` is only ever set
// true after a genuine 2xx from os-install.
// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('return_prime_merchants')
    .addColumn('rp_registered', 'boolean', (c) => c.notNull().defaultTo(false))
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('return_prime_merchants').dropColumn('rp_registered').execute();
}
