# Preserve feed failure history (append-only feed-event log) — spec

- **Slug:** add-feed-event-log   **Type:** fix (delivered as feature-tier work)   **Size:** feature
- **Area:** apps/google (backend `modules/google/gmc` + `modules/google/db`, admin `admin-google`)

## Problem / goal

**Observed (bug report):** On the Google app's **Product Feed** page, when a product/variant
that previously failed (`ERROR`) is re-synced and now succeeds (`SYNCED`), the previous failed
entry is overwritten to success. No separate success entry is created and the historical failure
is lost, so there is no audit trail of past failures.

**Confirmed root cause:** `FeedSyncService.writeFeedItem()`
(`apps/backend/src/modules/google/gmc/feed-sync.service.ts:304`) writes per-offer status with
`insertInto('google_feed_items').onDuplicateKeyUpdate(...)`. The table has a unique constraint
`uq_google_feed_items_merchant_offer` on `(merchant_id, offer_id)`
(`db/migrations/0001_initial.ts:176`), so each offer has exactly **one** row. A later success
overwrites the same row in place (`ERROR → SYNCED`), discarding the failure.

`google_feed_items` is intentionally a **current-state-per-offer** table (powers the "Feed items"
grid, keyed/paginated by offer). `google_sync_log` (the "Sync history" card) is already
append-only, but it is a per-*run* summary — it does not record per-offer status transitions.

**Goal:** Preserve per-offer status history (especially failures) without changing the
current-state semantics of `google_feed_items`, and surface that history in the admin.

## Approach

Keep `google_feed_items` exactly as-is (current status per offer). Add a new **append-only**
`google_feed_events` table that records a row each time an offer's status **changes**, then
surface it on the Product Feed page.

**Why "on change" rather than "every write":** a full sync calls `writeFeedItem` for every
offer on every run. Logging every write would flood the table with duplicate `SYNCED` rows.
Logging only on a status transition (including first-ever observation) captures exactly what the
report asks for — the `ERROR` is preserved as its own row and the later `SYNCED` is appended as a
new row — while keeping steady-state syncs (no change) at zero new events.

Work items:

1. **Migration** `db/migrations/0003_feed_events.ts` — create `google_feed_events`:
   - `id` bigint PK autoincrement; `merchant_id` varchar(128) NOT NULL;
     `offer_id` varchar(255) NOT NULL; `product_id` varchar(128) NOT NULL;
     `variant_id` varchar(128) NULL; `title` varchar(255) NULL;
     `status` enum('SYNCED','PENDING','ERROR','WARNING','DELETED') NOT NULL;
     `previous_status` enum(...) NULL (the status it changed from; NULL for first observation);
     `issue` varchar(512) NULL; `sync_type` enum('webhook','auto','reconcile','initial','manual') NULL;
     `created_at` datetime(3) default CURRENT_TIMESTAMP(3).
   - FK `merchant_id → merchants(id)` ON DELETE CASCADE.
   - Index `(merchant_id, created_at)` for the history view; index `(merchant_id, offer_id, created_at)`
     for per-offer drill-down. No unique constraint (append-only).
   - `down()` drops the table.

2. **Types** `db/types.ts` — add `GoogleFeedEventsTable` interface + register
   `google_feed_events` on `GoogleDatabase`; export `GoogleFeedEventRow`.

3. **Write path** `gmc/feed-sync.service.ts` — in `writeFeedItem()`, read the offer's current
   `status` before the upsert; if it differs from the new status (or no row exists), insert a
   `google_feed_events` row capturing `{status, previousStatus, issue, syncType, title, productId,
   variantId}`. Thread the originating `syncType` into `writeFeedItem` (currently not passed).
   The `deleteProduct()` path (sets `DELETED`) records a `DELETED` transition the same way.

4. **Read path** `gmc/feed-query.service.ts` — add `events(merchantId, { offerId?, page, limit })`
   returning `{ items, total }`, newest first, optionally filtered by `offerId`.

5. **API** `gmc/feed.controller.ts` — add `@Get('events')` (merchant-guarded) with `page`/`limit`
   (limit capped at 100, default 20) and optional `offerId` query param.

6. **Admin hook** `admin-google/src/hooks/useFeed.ts` — add `FeedEventRow` type, `queryKeys.feedEvents(...)`,
   and `useFeedEvents(offerId?, page, limit)`.

7. **Admin UI** `admin-google/src/routes/feed.tsx` — add a **"Status change history"** card: a
   paginated, newest-first table of events (Product/offer, From → To status with colour tags,
   Issue, time). Reuse the existing `STATUS_COLOR` map.

**Alternatives considered (rejected):**
- *Make `google_feed_items` itself append-only* (drop the unique constraint, insert every sync):
  breaks the offer-keyed current-status grid, summary counts, and pagination. Rejected — the user
  chose a separate log.
- *Log every write, dedupe in the query*: storage bloat and defeats a clean audit trail. Rejected
  in favour of transition-only logging.

## Acceptance criteria

- [ ] A new `google_feed_events` migration exists and `pnpm --filter backend migrate` applies cleanly (up + down).
- [ ] When an offer goes `ERROR` then later `SYNCED`, `google_feed_items` shows one row = `SYNCED`,
      AND `google_feed_events` contains both an `ERROR` row and a later `SYNCED` row (failure preserved).
- [ ] Re-syncing an offer whose status is unchanged adds **no** new `google_feed_events` row.
- [ ] First-ever observation of an offer records one event with `previous_status = NULL`.
- [ ] The `DELETED` transition (delete webhook) records a `DELETED` event.
- [ ] `GET /google/api/feed/events` returns events newest-first, paginated, merchant-scoped, with optional `offerId` filter.
- [ ] The Product Feed admin page shows a "Status change history" card listing the events.
- [ ] `pnpm verify` is green (lint + typecheck + build + tests, including new tests for the write/query/controller paths).

## Out of scope

- Backfilling history for existing offers (the log starts accruing from deploy).
- Changing `google_sync_log` (per-run "Sync history") — already append-only and unaffected.
- Any change to the Meta catalog sync logs (each run already gets its own row; not the reported bug).
- Retention/pruning policy for `google_feed_events` (note as a future follow-up if volume warrants).

## Context consulted

- `docs/agent/apps/google/CONTEXT.md` — GMC server-side feed sync via Content API; durable
  per-product sync via the `google-product-sync` SQS queue + worker; prices are integer paise.
  No prior decision constrains adding an append-only event log.
- Root-cause trace: `feed-sync.service.ts` (`writeFeedItem`/`deleteProduct`/`writeSyncLog`),
  `db/migrations/0001_initial.ts` (`google_feed_items` unique key), `feed-query.service.ts`,
  `feed.controller.ts`, `admin-google/src/{routes/feed.tsx,hooks/useFeed.ts}`.
