/**
 * Carrier data model (Delhivery Direct — TRD §3).
 *
 * 1. Reshape `delhivery_configs` from the scaffolded analytics template
 *    (`api_key`/`host`/`debug`/`events`) to the real carrier config:
 *    encrypted API token, pickup location, GSTIN, cutoff, AWB trigger,
 *    default box dims, per-merchant kill switch.
 * 2. Create `delhivery_shipments` — the module-owned shipment record
 *    (source of truth; no Ratio Fulfillment Service). UNIQUE
 *    `(merchant_id, order_number)` = Delhivery `order` idempotency key.
 * 3. Create `delhivery_tracking_events` — tracking audit + dedupe; UNIQUE
 *    `(awb, unified_status)` enforces one app-side event per transition.
 *
 * NOTE: numbered 0004 — the scaffold copied the template's 0002/0003
 * migrations, which have already run wherever the module was installed, so
 * the carrier reshape must come after them (0001–0003 are never edited).
 */

import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  // Single ALTER so the table rewrite (if MySQL chooses COPY) happens once.
  // delhivery_configs is one row per merchant — tiny, safe to rewrite.
  // `api_token_enc` is NOT NULL with no default: MySQL backfills existing
  // rows with the TEXT implicit default '' (empty = "not configured yet").
  await sql`ALTER TABLE delhivery_configs
    DROP COLUMN api_key,
    DROP COLUMN host,
    DROP COLUMN debug,
    DROP COLUMN events,
    ADD COLUMN api_token_enc TEXT NOT NULL,
    ADD COLUMN pickup_location_name VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN gstin VARCHAR(20) NOT NULL DEFAULT '',
    ADD COLUMN pickup_cutoff VARCHAR(5) NOT NULL DEFAULT '10:00',
    ADD COLUMN awb_trigger VARCHAR(8) NOT NULL DEFAULT 'auto',
    ADD COLUMN default_box_lcm INT NOT NULL DEFAULT 10,
    ADD COLUMN default_box_bcm INT NOT NULL DEFAULT 10,
    ADD COLUMN default_box_hcm INT NOT NULL DEFAULT 10,
    ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT FALSE`.execute(db);

  await db.schema
    .createTable('delhivery_shipments')
    .addColumn('id', 'varchar(128)', (c) => c.notNull().primaryKey())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('order_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('order_number', 'varchar(128)', (c) => c.notNull())
    .addColumn('awb', 'varchar(64)')
    .addColumn('carrier', 'varchar(32)', (c) => c.notNull().defaultTo('DELHIVERY'))
    .addColumn('status', 'varchar(32)', (c) => c.notNull())
    .addColumn('payment_mode', 'varchar(8)', (c) => c.notNull())
    .addColumn('cod_amount', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('weight_grams', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('label_url', 'varchar(512)')
    .addColumn('estimated_delivery', 'datetime(3)')
    .addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('pickup_requested_at', 'datetime(3)')
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint(
      'fk_delhivery_shipments_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .addUniqueConstraint('uq_delhivery_shipments_order_number', ['merchant_id', 'order_number'])
    .execute();

  await db.schema
    .createIndex('idx_delhivery_shipments_awb')
    .on('delhivery_shipments')
    .columns(['awb'])
    .execute();

  await db.schema
    .createIndex('idx_delhivery_shipments_status')
    .on('delhivery_shipments')
    .columns(['merchant_id', 'status'])
    .execute();

  await db.schema
    .createTable('delhivery_tracking_events')
    .addColumn('id', 'varchar(128)', (c) => c.notNull().primaryKey())
    .addColumn('awb', 'varchar(64)', (c) => c.notNull())
    .addColumn('raw_status', 'varchar(64)', (c) => c.notNull())
    .addColumn('unified_status', 'varchar(32)', (c) => c.notNull())
    .addColumn('location', 'varchar(255)')
    .addColumn('event_ts', 'datetime(3)')
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addUniqueConstraint('uq_delhivery_tracking_awb_status', ['awb', 'unified_status'])
    .execute();

  await db.schema
    .createIndex('idx_delhivery_tracking_awb')
    .on('delhivery_tracking_events')
    .columns(['awb'])
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('delhivery_tracking_events').ifExists().execute();
  await db.schema.dropTable('delhivery_shipments').ifExists().execute();
  await sql`ALTER TABLE delhivery_configs
    DROP COLUMN api_token_enc,
    DROP COLUMN pickup_location_name,
    DROP COLUMN gstin,
    DROP COLUMN pickup_cutoff,
    DROP COLUMN awb_trigger,
    DROP COLUMN default_box_lcm,
    DROP COLUMN default_box_bcm,
    DROP COLUMN default_box_hcm,
    DROP COLUMN enabled,
    ADD COLUMN api_key VARCHAR(128) NOT NULL,
    ADD COLUMN host VARCHAR(255) NOT NULL,
    ADD COLUMN debug BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN events JSON`.execute(db);
}
