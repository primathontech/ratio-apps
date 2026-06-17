/**
 * 0004 — Catalog access token + per-merchant item map (Phase 2 finalization).
 *
 * Per TRD §0:
 *  - `meta_configs.catalog_access_token` — the Catalog Batch API needs the
 *    `catalog_management` scope, which the CAPI/pixel token does NOT carry. So
 *    we store a SEPARATE token, encrypted at rest (AES-256-GCM via
 *    CryptoService), exactly like `capi_access_token`. Empty string = not set.
 *  - `catalog_items` — id map between os-item products and the `retailer_id`
 *    sent to Meta. `content_hash` lets the sync skip no-op updates; the map
 *    lets reconciliation DELETE orphans (products removed in os-item).
 *
 * Additive only — safe to roll forward on live DBs.
 */

import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  // Encrypted catalog token (NOT NULL DEFAULT '' so the install-seeded row and
  // existing rows stay valid; '' = "not configured", same convention as the
  // CAPI token).
  await sql`
    ALTER TABLE meta_configs
      ADD COLUMN catalog_access_token VARCHAR(1024) NOT NULL DEFAULT '' AFTER catalog_id
  `.execute(db);

  await db.schema
    .createTable('catalog_items')
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    // retailer_id is the id sent to Meta (= event content_ids). 191 keeps the
    // composite PK under InnoDB's utf8mb4 index-length limit.
    .addColumn('retailer_id', 'varchar(191)', (c) => c.notNull())
    .addColumn('source_product_id', 'varchar(128)', (c) => c.notNull())
    // sha256 hex of the transformed Meta item → skip pushing unchanged items.
    .addColumn('content_hash', 'char(64)', (c) => c.notNull())
    // synced | deleted | error
    .addColumn('last_status', 'varchar(16)', (c) => c.notNull())
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addPrimaryKeyConstraint('pk_catalog_items', ['merchant_id', 'retailer_id'])
    .addForeignKeyConstraint(
      'fk_catalog_items_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  // Diff/reconcile by source product (find all retailer_ids a product produced).
  await db.schema
    .createIndex('idx_catalog_items_merchant_product')
    .on('catalog_items')
    .columns(['merchant_id', 'source_product_id'])
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('catalog_items').ifExists().execute();
  await sql`ALTER TABLE meta_configs DROP COLUMN catalog_access_token`.execute(db);
}
