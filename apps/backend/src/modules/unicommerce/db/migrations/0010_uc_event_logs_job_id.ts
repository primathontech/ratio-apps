/**
 * 0010 — Add a nullable `job_id` column to `uc_event_logs`.
 *
 * The admin sync-activity dashboard's Retry button needs to map an event-log
 * row back to the `uc_sync_jobs` row it came from — `uc_event_logs.id` and
 * `uc_sync_jobs.id` are two completely unrelated id spaces (each table has
 * its own primary key), so the frontend was sending the event-log's own id
 * as if it were a job id, which matches zero rows and silently no-ops.
 *
 * Nullable, no default: only `order_push`/`cancel_push` events written from
 * `UcSyncQueueService` (which always has a `uc_sync_jobs` row in scope) set
 * this. The auth/catalog/inventory/status/dispatch/cancel controllers from
 * Task 14 have no corresponding job row and leave it NULL.
 *
 * Deliberately NO foreign key to `uc_sync_jobs(id)`, for the same reason as
 * 0008's dropped FK on `uc_order_item_map`: event-log writes happen from
 * `UcSyncQueueService`'s own DB handle while a caller (webhook dispatch, or a
 * future transactional caller) may be holding a lock on a related row on a
 * different connection — adding a synchronous FK dependency here risks the
 * exact same cross-connection lock-wait deadlock 0008 already reproduced and
 * fixed, so this migration does not reintroduce that class of bug via a new
 * FK. The app layer already knows `job.id` is valid at every write site
 * (it's read from `uc_sync_jobs` moments earlier in the same call), so the FK
 * would enforce nothing the code doesn't already guarantee.
 */
import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('uc_event_logs').addColumn('job_id', 'char(36)').execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE uc_event_logs DROP COLUMN job_id`.execute(db);
}
