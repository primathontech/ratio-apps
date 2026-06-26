/**
 * 0004 — Drop the merchants FK from google_feed_events.
 *
 * google_feed_events is an append-only AUDIT log. The FK to merchants(id) added
 * in 0003 makes every event insert fail with ER_NO_REFERENCED_ROW whenever the
 * merchant row isn't present in this module's `merchants` table — which silently
 * stranded the entire "Status change history": feed items wrote fine (that table
 * has no such FK), but every status-change event was rejected, so the history
 * stayed empty regardless of how many times a product was re-synced.
 *
 * An audit row that outlives or predates its merchant row is desirable, not a
 * violation. google_feed_items already has no merchants FK, so dropping this one
 * also restores consistency between the two tables. The (merchant_id, ...)
 * indexes from 0003 remain, so per-merchant reads keep their index.
 *
 * Safe to roll forward on live DBs (drops a constraint only; no data change).
 */
import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE google_feed_events
      DROP FOREIGN KEY fk_google_feed_events_merchant
  `.execute(db);
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  // Re-add the constraint on rollback. Requires every existing event's
  // merchant_id to be present in merchants — true for the dev DBs where
  // migrate-down is allowed to run.
  await sql`
    ALTER TABLE google_feed_events
      ADD CONSTRAINT fk_google_feed_events_merchant
      FOREIGN KEY (merchant_id) REFERENCES merchants (id) ON DELETE CASCADE
  `.execute(db);
}
