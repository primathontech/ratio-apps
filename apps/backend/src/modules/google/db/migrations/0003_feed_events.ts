import { type Kysely, sql } from 'kysely';

const STATUS = sql`enum('SYNCED','PENDING','ERROR','WARNING','DELETED')`;
const SYNC_TYPE = sql`enum('webhook','auto','reconcile','initial','manual')`;

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  // google_feed_events — append-only per-offer status-change log (audit history).
  // Unlike google_feed_items (one current row per offer, upserted in place), this
  // table NEVER overwrites: each status transition (including the first time an
  // offer is seen) is a new row, so a failure that later succeeds keeps its record.
  await db.schema
    .createTable('google_feed_events')
    .addColumn('id', 'bigint', (c) => c.notNull().primaryKey().autoIncrement())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('offer_id', 'varchar(255)', (c) => c.notNull())
    .addColumn('product_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('variant_id', 'varchar(128)')
    .addColumn('title', 'varchar(255)')
    .addColumn('status', STATUS, (c) => c.notNull())
    .addColumn('previous_status', STATUS)
    .addColumn('issue', 'varchar(512)')
    .addColumn('sync_type', SYNC_TYPE)
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint(
      'fk_google_feed_events_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  // History view scans newest-first per merchant.
  await db.schema
    .createIndex('idx_google_feed_events_merchant_created')
    .on('google_feed_events')
    .columns(['merchant_id', 'created_at'])
    .execute();

  // Per-offer drill-down.
  await db.schema
    .createIndex('idx_google_feed_events_merchant_offer_created')
    .on('google_feed_events')
    .columns(['merchant_id', 'offer_id', 'created_at'])
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('google_feed_events').ifExists().execute();
}
