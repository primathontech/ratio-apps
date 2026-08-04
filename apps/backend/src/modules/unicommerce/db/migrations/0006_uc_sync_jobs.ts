import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('uc_sync_jobs')
    .addColumn('id', 'char(36)', (c) => c.notNull().primaryKey().defaultTo(sql`(UUID())`))
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('type', 'varchar(32)', (c) => c.notNull()) // 'order_push' | 'cancel_push'
    .addColumn('ratio_order_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('payload', 'json', (c) => c.notNull())
    .addColumn('status', 'varchar(16)', (c) => c.notNull().defaultTo('PENDING')) // PENDING|RETRYING|NEEDS_MANUAL|DONE
    .addColumn('attempt_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('next_retry_at', 'datetime(3)')
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    // Set once an `order_push` job's push succeeds (the Unicommerce-assigned
    // saleOrderCode). Task 9's `orders/cancelled` handler reads this back via
    // `UcOrderItemMapService.findSaleOrderCode` to know what to cancel — a
    // NULL value means the order was never successfully pushed in the first
    // place, which the cancel handler treats as a no-op.
    .addColumn('sale_order_code', 'varchar(64)')
    .addForeignKeyConstraint('fk_uc_sync_jobs_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createTable('uc_dlq')
    .addColumn('id', 'char(36)', (c) => c.notNull().primaryKey().defaultTo(sql`(UUID())`))
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('original_job_id', 'char(36)', (c) => c.notNull())
    .addColumn('payload', 'json', (c) => c.notNull())
    .addColumn('attempts', 'integer', (c) => c.notNull())
    .addColumn('last_error', 'text', (c) => c.notNull())
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
    .execute();

  await db.schema.createIndex('idx_uc_sync_jobs_retry').on('uc_sync_jobs').columns(['status', 'next_retry_at']).execute();
}
