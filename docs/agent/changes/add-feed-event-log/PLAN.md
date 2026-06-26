# Preserve feed failure history (append-only feed-event log) — implementation plan

**Goal:** Add an append-only `google_feed_events` log that records every per-offer status change (preserving failures), and surface it on the Product Feed admin page — without changing `google_feed_items` current-state semantics.
**Spec:** docs/agent/changes/add-feed-event-log/SPEC.md
**Execution:** invoke the `execute` skill (it asks subagent-driven vs inline).

> **Testing note:** backend tests live under `apps/backend/test/unit/`. `apps/backend/test/unit/apps/google/feed-sync.service.test.ts` already exercises `FeedSyncService` against a hand-rolled fake Kysely client (`makeFakeKysely`) that captures writes — so we TDD the **actual** event-logging behavior there (first observation logs; failure→success logs both; unchanged logs nothing; delete logs DELETED), plus the admin render (matching `apps/admin-google/src/routes/feed.test.tsx`). The migration is verified via `typecheck` + a manual `pnpm migrate:google` against a running MySQL (migrations are never unit-tested). Each task ends green at `pnpm verify`; while iterating use the targeted commands shown.

---

### Task 1: Migration — create `google_feed_events`
**Files:** Create `apps/backend/src/modules/google/db/migrations/0003_feed_events.ts`
- [ ] Write the migration (mirrors the style of `0001_initial.ts` `google_feed_items`/`google_sync_log` blocks):
```ts
import { type Kysely, sql } from 'kysely';

const STATUS = sql`enum('SYNCED','PENDING','ERROR','WARNING','DELETED')`;
const SYNC_TYPE = sql`enum('webhook','auto','reconcile','initial','manual')`;

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  // google_feed_events — append-only per-offer status-change log (audit history).
  // Unlike google_feed_items (one current row per offer), this NEVER overwrites:
  // each status transition (incl. first observation) is a new row.
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
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
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
```
- [ ] Verify it compiles: `pnpm --filter @ratio-app/backend typecheck`
- [ ] Apply against a running MySQL (manual / deploy step — no DB in CI): `pnpm migrate:google`, then `pnpm migrate:down:google` and re-`pnpm migrate:google` to confirm down+up are clean.
- [ ] Commit.

---

### Task 2: DB types — register the new table
**Files:** Modify `apps/backend/src/modules/google/db/types.ts`
- [ ] Add the table interface after `GoogleSyncLogTable`:
```ts
/** Append-only per-offer status-change log (audit history). */
interface GoogleFeedEventsTable {
  id: Generated<number>;
  merchantId: string;
  offerId: string;
  productId: string;
  variantId: string | null;
  title: string | null;
  status: FeedItemStatus;
  previousStatus: FeedItemStatus | null;
  issue: string | null;
  syncType: SyncType | null;
  createdAt: Generated<Date>;
}
```
- [ ] Register it on `GoogleDatabase`: add `google_feed_events: GoogleFeedEventsTable;`
- [ ] Export the row type next to the others: `export type GoogleFeedEventRow = Selectable<GoogleFeedEventsTable>;`
- [ ] Verify: `pnpm --filter @ratio-app/backend typecheck`
- [ ] Commit.

---

### Task 3: Transition-decision helper (TDD, pure)
**Files:** Modify `apps/backend/src/modules/google/gmc/feed-sync.service.ts`; Modify `apps/backend/test/unit/apps/google/feed-sync.service.test.ts`
- [ ] Write the failing test — add this `describe` block to the existing test file and add `isFeedStatusTransition` to its `FeedSyncService` import:
```ts
describe('isFeedStatusTransition', () => {
  it('logs first observation (no prior row)', () => {
    expect(isFeedStatusTransition(null, 'ERROR')).toBe(true);
  });
  it('logs a real change (failure → success)', () => {
    expect(isFeedStatusTransition('ERROR', 'SYNCED')).toBe(true);
  });
  it('does not log when status is unchanged', () => {
    expect(isFeedStatusTransition('SYNCED', 'SYNCED')).toBe(false);
    expect(isFeedStatusTransition('ERROR', 'ERROR')).toBe(false);
  });
});
```
- [ ] Run it — expect FAIL (import missing): `pnpm --filter @ratio-app/backend exec vitest run test/unit/apps/google/feed-sync.service.test.ts`
- [ ] Add the exported helper at module top of `feed-sync.service.ts` (after imports), plus the `FeedItemStatus` import:
```ts
import type { FeedItemStatus } from '@ratio-app/shared/schemas/google-config';
// ...
/**
 * A feed-item status change worth recording in the append-only event log:
 * any time the new status differs from the stored one. A null prior status
 * means the offer was never seen before — that first observation is logged too.
 */
export function isFeedStatusTransition(
  previous: FeedItemStatus | null | undefined,
  next: FeedItemStatus,
): boolean {
  return (previous ?? null) !== next;
}
```
- [ ] Run it — expect PASS (same command).
- [ ] Commit.

---

### Task 4: Write path — record events on transition (TDD against the fake Kysely)
**Files:** Modify `apps/backend/src/modules/google/gmc/feed-sync.service.ts`, `apps/backend/test/unit/apps/google/feed-sync.service.test.ts`

**4a — Extend the fake to capture event writes + a configurable prior status.** In `makeFakeKysely`:
- Add a captured array + return field: `const feedEventWrites: { offerId: string; status: string; previousStatus: string | null; syncType: string | null }[] = [];` and return it alongside the others.
- Widen `feedItemRows` to carry a prior status: `feedItemRows?: { offerId: string; status?: string; productId?: string; variantId?: string | null; title?: string | null }[];` (the new `writeFeedItem` prior-status read uses `feedItemSelect.executeTakeFirst()`, which already returns `feedItemRows[0]`).
- Add an insert builder for the new table and wire it into `insertInto`:
```ts
const feedEventInsert = {
  staged: null as Record<string, unknown> | null,
  values(v: Record<string, unknown>) { this.staged = v; return this; },
  async execute() {
    const v = this.staged ?? {};
    feedEventWrites.push({
      offerId: String(v.offerId ?? ''),
      status: String(v.status ?? ''),
      previousStatus: (v.previousStatus ?? null) as string | null,
      syncType: (v.syncType ?? null) as string | null,
    });
    this.staged = null;
    return [];
  },
};
// in insertInto(table): if (table === 'google_feed_events') return feedEventInsert;
```
> Note: existing tests don't assert on `feedEventWrites`, but after Task 4 every `writeFeedItem`/`deleteProduct` may insert an event — the `insertInto('google_feed_events')` branch MUST exist or those tests throw `unexpected insertInto`.

**4b — Write the failing behavior tests** (add to the `syncProduct` / `deleteProduct` describes):
```ts
it('logs a feed event on first observation (previousStatus null)', async () => {
  const fake = makeFakeKysely({ config: configRow() }); // no prior row
  vi.stubGlobal('fetch', fakeFetch(() => ok()).fetch);
  const svc = new FeedSyncService(fake.handle, makeAuth(), makeProducts());
  await svc.syncProduct(MERCHANT_ID, makeProduct());
  expect(fake.feedEventWrites).toEqual([
    { offerId: `${MERCHANT_ID}:v1`, status: 'SYNCED', previousStatus: null, syncType: 'webhook' },
  ]);
});

it('logs a feed event when a failed offer later succeeds (ERROR → SYNCED)', async () => {
  const fake = makeFakeKysely({
    config: configRow(),
    feedItemRows: [{ offerId: `${MERCHANT_ID}:v1`, status: 'ERROR' }],
  });
  vi.stubGlobal('fetch', fakeFetch(() => ok()).fetch);
  const svc = new FeedSyncService(fake.handle, makeAuth(), makeProducts());
  await svc.syncProduct(MERCHANT_ID, makeProduct());
  expect(fake.feedEventWrites).toEqual([
    { offerId: `${MERCHANT_ID}:v1`, status: 'SYNCED', previousStatus: 'ERROR', syncType: 'webhook' },
  ]);
});

it('does NOT log a feed event when the status is unchanged', async () => {
  const fake = makeFakeKysely({
    config: configRow(),
    feedItemRows: [{ offerId: `${MERCHANT_ID}:v1`, status: 'SYNCED' }],
  });
  vi.stubGlobal('fetch', fakeFetch(() => ok()).fetch);
  const svc = new FeedSyncService(fake.handle, makeAuth(), makeProducts());
  await svc.syncProduct(MERCHANT_ID, makeProduct());
  expect(fake.feedEventWrites).toHaveLength(0);
});
```
And extend the existing delete test to assert DELETED events (give the rows a prior status):
```ts
// in 'deletes each offer ... marks DELETED': change feedItemRows to
//   [{ offerId: 'm:v1', status: 'SYNCED' }, { offerId: 'm:v2', status: 'SYNCED' }]
// then add:
expect(fake.feedEventWrites.map((e) => [e.offerId, e.status])).toEqual([
  ['m:v1', 'DELETED'],
  ['m:v2', 'DELETED'],
]);
```
- [ ] Run them — expect FAIL: `pnpm --filter @ratio-app/backend exec vitest run test/unit/apps/google/feed-sync.service.test.ts`

**4c — Implement.** In `feed-sync.service.ts`:
- [ ] Replace `writeFeedItem` so it reads the prior status, upserts the item, then appends an event on transition. Change the third arg from `synced = false` to an options object carrying `syncType`:
```ts
private async writeFeedItem(
  merchantId: string,
  offer: MappedOffer,
  opts: { synced?: boolean; syncType: SyncType },
): Promise<void> {
  const status = offer.status;
  const prior = await this.handle.db
    .selectFrom('google_feed_items')
    .select('status')
    .where('merchantId', '=', merchantId)
    .where('offerId', '=', offer.offerId)
    .executeTakeFirst();
  const previousStatus = prior?.status ?? null;

  await this.handle.db
    .insertInto('google_feed_items')
    .values({
      merchantId,
      offerId: offer.offerId,
      productId: offer.productId,
      variantId: offer.variantId,
      title: offer.title.slice(0, 255),
      status,
      hasGtin: offer.hasGtin,
      issue: offer.issue,
      lastSyncedAt: opts.synced ? sql`CURRENT_TIMESTAMP(3)` : null,
    } as never)
    .onDuplicateKeyUpdate({
      productId: offer.productId,
      variantId: offer.variantId,
      title: offer.title.slice(0, 255),
      status,
      hasGtin: offer.hasGtin,
      issue: offer.issue,
      ...(opts.synced ? { lastSyncedAt: sql`CURRENT_TIMESTAMP(3)` } : {}),
      updatedAt: sql`CURRENT_TIMESTAMP(3)`,
    } as never)
    .execute();

  if (isFeedStatusTransition(previousStatus, status)) {
    await this.recordFeedEvent(merchantId, offer, status, previousStatus, opts.syncType);
  }
}

/** Append one row to the audit log (never overwrites). */
private async recordFeedEvent(
  merchantId: string,
  offer: Pick<MappedOffer, 'offerId' | 'productId' | 'variantId' | 'title' | 'issue'>,
  status: FeedItemStatus,
  previousStatus: FeedItemStatus | null,
  syncType: SyncType,
): Promise<void> {
  await this.handle.db
    .insertInto('google_feed_events')
    .values({
      merchantId,
      offerId: offer.offerId,
      productId: offer.productId,
      variantId: offer.variantId,
      title: offer.title?.slice(0, 255) ?? null,
      status,
      previousStatus,
      issue: offer.issue ?? null,
      syncType,
    } as never)
    .execute();
}
```
- [ ] Update the three `writeFeedItem` call sites to pass `syncType`:
  - In `syncProduct` (error/no-gmc branch): `await this.writeFeedItem(merchantId, offer, { syncType });`
  - In `syncProduct` (success branch): `await this.writeFeedItem(merchantId, offer, { synced: true, syncType });`
  - In `syncProduct` (catch/permanent-ERROR branch): `await this.writeFeedItem(merchantId, { ...offer, status: 'ERROR', issue }, { syncType });`
  - In `runFullSync` (pre-loop ERROR/no-gmc items): `await this.writeFeedItem(merchantId, offer, { syncType });`
  - In `runFullSync` (batch rejected): `await this.writeFeedItem(merchantId, { ...offer, status: 'ERROR', issue: 'GMC batch rejected' }, { syncType });`
  - In `runFullSync` (batch success): `await this.writeFeedItem(merchantId, offer, { synced: true, syncType });`
- [ ] Update `deleteProduct` to log DELETED transitions. Change its select to include `status`, and after the `updateTable(... DELETED ...)` append an event per offer whose prior status was not already `DELETED`:
```ts
// near the top of deleteProduct — also select prior status:
const items = await this.handle.db
  .selectFrom('google_feed_items')
  .select(['offerId', 'productId', 'variantId', 'title', 'status'])
  .where('merchantId', '=', merchantId)
  .where('productId', '=', productId)
  .execute();
// ... existing GMC delete loop uses item.offerId ...
// after the bulk updateTable(... status: 'DELETED' ...):
for (const it of items) {
  if (isFeedStatusTransition(it.status, 'DELETED')) {
    await this.recordFeedEvent(
      merchantId,
      { offerId: it.offerId, productId: it.productId, variantId: it.variantId, title: it.title, issue: null },
      'DELETED',
      it.status,
      'webhook',
    );
  }
}
```
  (The existing `for (const { offerId } of items)` GMC-delete loop still works since `offerId` is still selected.)
- [ ] Run the behavior tests — expect PASS: `pnpm --filter @ratio-app/backend exec vitest run test/unit/apps/google/feed-sync.service.test.ts`
- [ ] Verify: `pnpm --filter @ratio-app/backend typecheck`
- [ ] Commit.

---

### Task 5: Read path — query + endpoint
**Files:** Modify `apps/backend/src/modules/google/gmc/feed-query.service.ts`, `apps/backend/src/modules/google/gmc/feed.controller.ts`
- [ ] Add to `feed-query.service.ts` a `FeedEventView` interface and an `events` method:
```ts
export interface FeedEventView {
  offerId: string;
  productId: string;
  variantId: string | null;
  title: string | null;
  status: FeedItemStatus;
  previousStatus: FeedItemStatus | null;
  issue: string | null;
  syncType: string | null;
  createdAt: string;
}

async events(
  merchantId: string,
  opts: { offerId?: string; page: number; limit: number },
): Promise<{ items: FeedEventView[]; total: number }> {
  let base = this.handle.db.selectFrom('google_feed_events').where('merchantId', '=', merchantId);
  if (opts.offerId) base = base.where('offerId', '=', opts.offerId);

  const totalRow = await base.select((eb) => eb.fn.countAll<number>().as('c')).executeTakeFirst();
  const rows = await base
    .selectAll()
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(opts.limit)
    .offset((opts.page - 1) * opts.limit)
    .execute();

  return {
    total: Number(totalRow?.c ?? 0),
    items: rows.map((r) => ({
      offerId: r.offerId,
      productId: r.productId,
      variantId: r.variantId,
      title: r.title,
      status: r.status,
      previousStatus: r.previousStatus,
      issue: r.issue,
      syncType: r.syncType,
      createdAt: new Date(r.createdAt).toISOString(),
    })),
  };
}
```
- [ ] Add the endpoint to `feed.controller.ts` (after `history`):
```ts
@Get('events')
events(
  @CurrentMerchant() merchant: Merchant,
  @Query('offerId') offerId?: string,
  @Query('page') page?: string,
  @Query('limit') limit?: string,
) {
  const parsedPage = Math.max(1, Number(page) || 1);
  const parsedLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  return this.query.events(merchant.id, {
    ...(offerId ? { offerId } : {}),
    page: parsedPage,
    limit: parsedLimit,
  });
}
```
- [ ] Verify: `pnpm --filter @ratio-app/backend typecheck`
- [ ] Commit.

---

### Task 6: Admin hook
**Files:** Modify `apps/admin-google/src/hooks/useFeed.ts`, `apps/admin-google/src/lib/queryKeys.ts`
- [ ] Add the query key to `queryKeys.ts`:
```ts
feedEvents: (offerId: string, page: number, limit: number) =>
  ['google', 'feed', 'events', offerId, page, limit] as const,
```
- [ ] Add the type + hook to `useFeed.ts`:
```ts
export interface FeedEventRow {
  offerId: string;
  productId: string;
  variantId: string | null;
  title: string | null;
  status: FeedItemStatus;
  previousStatus: FeedItemStatus | null;
  issue: string | null;
  syncType: string | null;
  createdAt: string;
}

export interface FeedEventsResponse {
  items: FeedEventRow[];
  total: number;
}

export function useFeedEvents(offerId: string, page: number, limit = 20) {
  const token = useMerchantStore((s) => s.token);
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (offerId) params.set('offerId', offerId);
  return useQuery({
    queryKey: queryKeys.feedEvents(offerId, page, limit),
    queryFn: () => api<FeedEventsResponse>('GET', `/api/feed/events?${params.toString()}`),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });
}
```
- [ ] Verify: `pnpm --filter @ratio-app/admin-google typecheck`
- [ ] Commit.

---

### Task 7: Admin UI — "Status change history" card (TDD render)
**Files:** Modify `apps/admin-google/src/routes/feed.tsx`, `apps/admin-google/src/routes/feed.test.tsx`
- [ ] Extend `feed.test.tsx`: in the existing `mockedApi.mockImplementation`, add a branch for the events endpoint, and add an assertion. Add to the mock:
```ts
if (path.startsWith('/api/feed/events')) {
  return Promise.resolve({
    items: [
      {
        offerId: 'off-2',
        productId: 'prod-2',
        variantId: 'v-2',
        title: 'Red Hat',
        status: 'SYNCED',
        previousStatus: 'ERROR',
        issue: null,
        syncType: 'manual',
        createdAt: '2026-06-09T09:00:00.000Z',
      },
    ],
    total: 1,
  });
}
```
  and a new test asserting the history card shows the transition:
```ts
it('renders the status change history with the prior → new status', async () => {
  // (reuse the same mockImplementation as the first test)
  renderWithProviders(<FeedPage />);
  await waitFor(() => expect(screen.getByText('Status change history')).toBeInTheDocument());
  expect(await screen.findByText(/ERROR/)).toBeInTheDocument();
});
```
- [ ] Run it — expect FAIL (card not rendered yet): `pnpm --filter @ratio-app/admin-google exec vitest run src/routes/feed.test.tsx`
- [ ] Add the card to `feed.tsx`. Add `useFeedEvents` to imports, local `eventsPage` state, call the hook, and render a new `<Card title="Status change history">` with a `<Table>` (columns: Product = `title || offerId`; Change = `previousStatus ?? '—'` → `status` as colour `<Tag>`s reusing `STATUS_COLOR`; Issue; When = `new Date(createdAt).toLocaleString()`), with `<Pagination>` like the items table. Place it between the "Feed items" card and the "Sync history" card. Use `rowKey` of `(r) => `${r.offerId}-${r.createdAt}`` (events aren't offer-unique).
- [ ] Run it — expect PASS (same command).
- [ ] Verify the whole repo: `pnpm verify`
- [ ] Commit.

---

### Definition of done
- [ ] All 7 tasks committed.
- [ ] `pnpm verify` green.
- [ ] `google_feed_events` migration applied on the target DB (`pnpm migrate:google`).
- [ ] Record the change via the `remember` skill (per the `execute` skill's DoD) and update `docs/agent/apps/google/CONTEXT.md`.
