import type { Kysely } from 'kysely';

// Dual-platform plan reversion: when an OS store links to an existing Shopify RP
// account (register()'s mode=login branch), RP's os-install response snapshots the
// merchant's pre-link plan as `previous_plan` (it's about to overwrite it with the
// free ENTERPRISE_OS tier). The adapter persists that snapshot here so it can be
// sent back to RP's os-uninstall endpoint on a real disable, restoring the
// merchant's original plan and severing the OS link — see RpWebhooksService.
// Stored as a JSON string (no native JSON column elsewhere in this table) —
// `{ plan, pricing_plan_details }`, opaque to the adapter, round-tripped as-is.
// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('return_prime_merchants')
    .addColumn('previous_plan', 'text', (c) => c.defaultTo(null))
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('return_prime_merchants').dropColumn('previous_plan').execute();
}
