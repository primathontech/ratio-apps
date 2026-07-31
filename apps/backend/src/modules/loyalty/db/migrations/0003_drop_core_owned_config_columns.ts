import { type Kysely, sql } from 'kysely';

/**
 * Drop the three `loyalty_configs` columns the Core Loyalty team owns:
 * `program_name`, `base_earn_rate`, `coin_value_inr`.
 *
 * DEPLOY ORDER MATTERS: ship the application code that stops reading these
 * columns BEFORE running this migration. The reading code paths removed
 * alongside it are `LoyaltyConfigService` (get/upsert), `StatsService`
 * (liability tile), `OrderCreatedHandler` + `RuleEvaluatorService` (multiplier
 * base), `StorefrontConfigService` and the QR claim/poster program label —
 * the label is now the `LOYALTY_PROGRAM_NAME` constant in
 * `@ratio-app/shared/schemas/loyalty-config`.
 *
 * `down()` restores the columns WITH their original defaults, so a rollback
 * leaves every existing merchant on the previous behaviour (name 'Coins',
 * rate 1, coin value 0.1). The per-merchant values themselves are NOT
 * recoverable once this has run — that is inherent to dropping the columns.
 */

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE loyalty_configs DROP COLUMN program_name`.execute(db);
  await sql`ALTER TABLE loyalty_configs DROP COLUMN base_earn_rate`.execute(db);
  await sql`ALTER TABLE loyalty_configs DROP COLUMN coin_value_inr`.execute(db);
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE loyalty_configs ADD COLUMN program_name VARCHAR(64) NOT NULL DEFAULT 'Coins'`.execute(
    db,
  );
  await sql`ALTER TABLE loyalty_configs ADD COLUMN base_earn_rate DECIMAL(10,4) NOT NULL DEFAULT '1'`.execute(
    db,
  );
  await sql`ALTER TABLE loyalty_configs ADD COLUMN coin_value_inr DECIMAL(10,4) NOT NULL DEFAULT '0.1'`.execute(
    db,
  );
}
