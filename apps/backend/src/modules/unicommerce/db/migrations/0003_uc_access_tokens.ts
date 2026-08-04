import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('uc_access_tokens')
    .addColumn('token_hash', 'varchar(255)', (c) => c.notNull().primaryKey())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('issued_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addColumn('expires_at', 'datetime(3)', (c) => c.notNull())
    .addForeignKeyConstraint('fk_uc_access_tokens_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  await db.schema.createIndex('idx_uc_access_tokens_merchant').on('uc_access_tokens').columns(['merchant_id']).execute();
}
