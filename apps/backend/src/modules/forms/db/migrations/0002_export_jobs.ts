import { type Kysely, sql } from 'kysely';

// Async CSV export jobs (background worker → S3 → signed download URL).
// A job row is the durable handoff between the merchant-guarded POST that
// creates it, the SQS-drained worker that streams the CSV into S3, and the
// GET that polls for the signed download URL. Kept in a NEW migration so
// 0001_initial stays frozen (types.ts is in lockstep with both).
//
// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('form_export_jobs')
    .addColumn('id', 'varchar(64)', (c) => c.notNull().primaryKey())
    .addColumn('form_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    // pending → processing → ready | failed.
    .addColumn('status', 'varchar(16)', (c) => c.notNull().defaultTo('pending'))
    // The object key of the finished CSV (null until the worker uploads it).
    .addColumn('s3_key', 'varchar(512)')
    // Data rows exported (header excluded); null until ready.
    .addColumn('row_count', 'integer')
    // Short failure message (null unless status = failed); never carries PII.
    .addColumn('error', 'varchar(512)')
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .execute();

  // The admin export history for a form lists newest-first within a merchant.
  await db.schema
    .createIndex('idx_form_export_jobs_merchant_form_created')
    .on('form_export_jobs')
    .columns(['merchant_id', 'form_id', 'created_at'])
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('form_export_jobs').ifExists().execute();
}
