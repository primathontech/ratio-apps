/**
 * Pickup warehouse address on `delhivery_configs` (Delhivery Direct — PRD §5
 * "warehouse registration flow", Must/v1).
 *
 * Adds the pickup-location address the app needs to (a) register the warehouse
 * with Delhivery's Warehouse Creation API (`pin`/`phone`/`address`/`return_address`)
 * and (b) supply `origin_pin` to the Expected TAT API for real per-lane EDD.
 *
 * Column names must match Kysely's CamelCasePlugin mapping of the table type:
 *   pickupPincode → pickup_pincode, pickupPhone → pickup_phone,
 *   pickupAddress → pickup_address, pickupCity → pickup_city.
 * All NOT NULL DEFAULT '' so existing single-row configs backfill safely
 * (empty pincode = "not set" → serviceability falls back to the EDD estimate).
 */

import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE delhivery_configs
    ADD COLUMN pickup_pincode VARCHAR(6) NOT NULL DEFAULT '',
    ADD COLUMN pickup_phone VARCHAR(15) NOT NULL DEFAULT '',
    ADD COLUMN pickup_address VARCHAR(512) NOT NULL DEFAULT '',
    ADD COLUMN pickup_city VARCHAR(128) NOT NULL DEFAULT ''`.execute(db);
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE delhivery_configs
    DROP COLUMN pickup_pincode,
    DROP COLUMN pickup_phone,
    DROP COLUMN pickup_address,
    DROP COLUMN pickup_city`.execute(db);
}
