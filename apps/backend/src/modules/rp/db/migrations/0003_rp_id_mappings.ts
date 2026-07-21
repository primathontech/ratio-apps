import { type Kysely, sql } from 'kysely';

// RP works entirely in Shopify-shape numeric ids; OS's real ids are UUIDs/large numeric
// strings, so the adapter hands RP a deterministic hash (hash-id.ts) instead. That hash is
// one-way — when RP sends a hashed id back (e.g. resolving a return's original product),
// the adapter has no way to compute the real OS id from the hash alone. This table is the
// adapter's own persistent reverse-lookup: written every time we mint a hash for something
// RP might later send back to us (order line items' product/variant ids, direct product
// fetches, product-create/update webhook forwards), read whenever RP sends a hashed id and
// we need the real one. Lives in ratio-apps' own database — no dependency on RP's own
// MongoDB, which is a separate system this adapter doesn't otherwise need to read.
//
// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('rp_id_mappings')
    .addColumn('id', 'char(36)', (c) => c.notNull().primaryKey().defaultTo(sql`(UUID())`))
    .addColumn('entity_type', 'varchar(32)', (c) => c.notNull())
    .addColumn('hashed_id', 'varchar(32)', (c) => c.notNull())
    .addColumn('real_id', 'varchar(255)', (c) => c.notNull())
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .execute();

  // (entity_type, hashed_id) is the lookup key — scoped by entity_type since two different
  // kinds of real id (e.g. a product and a variant) could theoretically hash to the same
  // number, and the caller always knows which kind it's resolving.
  await db.schema
    .createIndex('idx_rp_id_mappings_lookup')
    .on('rp_id_mappings')
    .columns(['entity_type', 'hashed_id'])
    .unique()
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('rp_id_mappings').ifExists().execute();
}
