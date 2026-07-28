import { type Kysely, sql } from 'kysely';
import { createSharedTables, dropSharedTables } from '../../../../core/db/shared-migrations';

// TODO(D9): `webhook_log.id` defaults to `UUID()` (UUIDv1), which is
// random-ordered and fragments the primary-key B-tree. MySQL 9.7 does not
// yet provide `UUID_v7()` (verified — error 1305), and an app-layer UUIDv7
// generator hasn't been adopted. Revisit and migrate the default to a
// time-ordered generator once either is available; see the matching
// comment on WebhooksService for the rollout options.
//
// Forms data model per TRD §3 / PRD: standard triad (merchants, oauth_tokens,
// webhook_log) + forms_configs, forms, form_submissions,
// form_webhook_deliveries, form_email_log, form_export_jobs.
//
// CONSOLIDATED SCHEMA: this single migration is the fold of what used to be
// five incremental migrations (0001 initial + 0002 export_jobs + 0003
// form_appearance + 0004 form_metadata + 0005 submission_context). The
// forms_app DB is dropped-and-recreated in every environment, so the
// incremental history carried no data and was squashed into this one clean
// initial schema. Column order below mirrors the exact order the five
// migrations produced (appended columns stay at the tail of their table).
//
// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await createSharedTables(db);

  // Per-merchant settings, seeded on install by FormsBootstrap.
  // recaptcha_secret_enc is AES-256-GCM ciphertext (write-only secret).
  await db.schema
    .createTable('forms_configs')
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull().primaryKey())
    .addColumn('recaptcha_site_key', 'varchar(255)')
    .addColumn('recaptcha_secret_enc', 'text')
    .addColumn('recaptcha_threshold', 'decimal(3, 2)', (c) => c.notNull().defaultTo(0.3))
    .addColumn('default_notification_email', 'varchar(320)')
    .addColumn('email_bounced', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('forms_enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addForeignKeyConstraint(
      'fk_forms_configs_merchant',
      ['merchant_id'],
      'merchants',
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  // The form definitions. schema_json holds the ordered field array
  // (shared `formFieldsSchema`), written with explicit JSON.stringify.
  // Soft delete only (deleted_at) — submissions outlive their form.
  //
  // The tail three columns were originally added incrementally:
  //   appearance_json (theme/appearance, nullable — an un-themed form keeps
  //     the SDK's baked-in defaults),
  //   description (subtitle/heading, max 500, nullable),
  //   redirect_url (https-only redirect-on-submit target, max 2048, nullable).
  await db.schema
    .createTable('forms')
    .addColumn('id', 'varchar(64)', (c) => c.notNull().primaryKey())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('name', 'varchar(255)', (c) => c.notNull())
    .addColumn('schema_json', 'json', (c) => c.notNull())
    .addColumn('submit_label', 'varchar(100)', (c) => c.notNull())
    .addColumn('success_message', 'text', (c) => c.notNull())
    .addColumn('spam_protection', 'varchar(16)', (c) => c.notNull().defaultTo('recaptcha'))
    .addColumn('notification_email', 'varchar(320)')
    .addColumn('webhook_url', 'varchar(2048)')
    .addColumn('status', 'varchar(16)', (c) => c.notNull().defaultTo('inactive'))
    .addColumn('deleted_at', 'datetime(3)')
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('appearance_json', 'json')
    .addColumn('description', 'varchar(500)')
    .addColumn('redirect_url', 'varchar(2048)')
    .addForeignKeyConstraint('fk_forms_merchant', ['merchant_id'], 'merchants', ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  // The admin list screen scans (merchant_id, deleted_at) on every load.
  await db.schema
    .createIndex('idx_forms_merchant_deleted')
    .on('forms')
    .columns(['merchant_id', 'deleted_at'])
    .execute();

  // Stored submissions. idempotency_key = sha256(form + session + 5s bucket)
  // — the UNIQUE constraint is the dedup mechanism (PRD F10). No FK to forms:
  // submissions must survive form soft-deletes and stay export-queryable.
  //
  // context_json (tail column) holds hidden-field provenance (field key →
  // { source, raw value }) captured at submit time — nullable; a submission
  // with no hidden fields writes null.
  await db.schema
    .createTable('form_submissions')
    .addColumn('id', 'varchar(64)', (c) => c.notNull().primaryKey())
    .addColumn('form_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('data_json', 'json', (c) => c.notNull())
    .addColumn('files_json', 'json')
    .addColumn('recaptcha_score', 'decimal(3, 2)')
    .addColumn('idempotency_key', 'varchar(128)', (c) => c.notNull().unique())
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('context_json', 'json')
    .execute();

  // Admin submissions list sorts by created_at within a form; CSV export scans it.
  await db.schema
    .createIndex('idx_form_submissions_form_created')
    .on('form_submissions')
    .columns(['form_id', 'created_at'])
    .execute();

  // Outbound `form.submitted` delivery state machine (pending → delivered |
  // failed after 3 attempts). The sweeper cron scans (status, next_retry_at).
  await db.schema
    .createTable('form_webhook_deliveries')
    .addColumn('id', 'bigint', (c) => c.notNull().primaryKey().autoIncrement())
    .addColumn('submission_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('form_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('url', 'varchar(2048)', (c) => c.notNull())
    .addColumn('status', 'varchar(16)', (c) => c.notNull().defaultTo('pending'))
    .addColumn('attempts', sql`tinyint`, (c) => c.notNull().defaultTo(0))
    .addColumn('last_status_code', sql`smallint`)
    .addColumn('next_retry_at', 'datetime(3)')
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .execute();

  await db.schema
    .createIndex('idx_form_webhook_deliveries_status_retry')
    .on('form_webhook_deliveries')
    .columns(['status', 'next_retry_at'])
    .execute();

  // Notification-email delivery log (pending → sent | failed | bounced;
  // one retry after 10 min). Same sweeper scan shape as deliveries.
  await db.schema
    .createTable('form_email_log')
    .addColumn('id', 'bigint', (c) => c.notNull().primaryKey().autoIncrement())
    .addColumn('submission_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('merchant_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('recipient', 'varchar(320)', (c) => c.notNull())
    .addColumn('status', 'varchar(16)', (c) => c.notNull().defaultTo('pending'))
    .addColumn('attempts', sql`tinyint`, (c) => c.notNull().defaultTo(0))
    .addColumn('next_retry_at', 'datetime(3)')
    .addColumn('created_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .addColumn('updated_at', 'datetime(3)', (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .execute();

  await db.schema
    .createIndex('idx_form_email_log_status_retry')
    .on('form_email_log')
    .columns(['status', 'next_retry_at'])
    .execute();

  // Async CSV export jobs (background worker → S3 → signed download URL).
  // A job row is the durable handoff between the merchant-guarded POST that
  // creates it, the SQS-drained worker that streams the CSV into S3, and the
  // GET that polls for the signed download URL.
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
  await db.schema.dropTable('form_email_log').ifExists().execute();
  await db.schema.dropTable('form_webhook_deliveries').ifExists().execute();
  await db.schema.dropTable('form_submissions').ifExists().execute();
  await db.schema.dropTable('forms').ifExists().execute();
  await db.schema.dropTable('forms_configs').ifExists().execute();
  await dropSharedTables(db);
}
