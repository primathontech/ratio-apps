import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('uc_event_logs')
    .addColumn('id', 'char(36)', (c) => c.notNull().primaryKey().defaultTo(sql`(UUID())`))
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('direction', 'varchar(16)', (c) => c.notNull()) // 'inbound' | 'outbound'
    .addColumn('flow', 'varchar(32)', (c) => c.notNull()) // auth|order_push|inventory|dispatch|cancel|status|catalog
    .addColumn('reference', 'varchar(128)', (c) => c.notNull())
    .addColumn('result', 'varchar(16)', (c) => c.notNull()) // success|failed|partial
    .addColumn('payload', 'json', (c) => c.notNull())
    .addColumn('response', 'json')
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .addForeignKeyConstraint('fk_uc_event_logs_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createIndex('idx_uc_event_logs_merchant_created')
    .on('uc_event_logs')
    .columns(['merchant_id', 'created_at'])
    .execute();
}
