# loyalty — context

Living context for the Loyalty app (coins program: earning rules, bulk
credit/debit, QR scan-to-earn, customer exports). Read before touching this
module. Standing context first; dated change journal below (newest first).

## Standing context

- **Core Loyalty is the ledger; this app is not.** Balances live in Core
  (`POST /api/v1/loyalty/points/{credit,debit}`, `GET …/{phone}/balance`) and
  every write carries a REQUIRED `idempotency_key`. `loyalty_customers` is a
  **mirror** for querying/segmentation, never the source of truth.
- **ONE phone normalization for the whole module** — `common/normalize-phone.ts`
  → E.164 `+91XXXXXXXXXX`, Indian mobiles only (10 digits starting 6-9, with
  `0`/`91`/`+91` prefixes tolerated). Everything touching the DB, a Core call, or
  an idempotency key goes through it, so a customer can't split into two loyalty
  identities by formatting (TRD §8 risk 2). The admin has an **exact port** in
  `apps/admin-loyalty/src/lib/parse-csv.ts` (`normalizeBulkPhone`) — change both
  together or the CSV preview lies about which rows the server will accept.
- **The mirror only exists if something puts it there.** `firstSeenSource` is
  `'order' | 'bulk' | 'qr' | 'manual'`: orders via
  `CustomerMirrorService.upsertFromOrder`, the other three via `ensurePhone`
  (INSERT IGNORE, so an existing row keeps its original source). A phone with no
  mirror row is **invisible** to the Customers screen, the leaderboard, exports
  and SEGMENT rules even when Core holds its coins — see the 2026-07-31 fix.
- **Bulk ops are a 4-step client-driven flow:** `POST /bulk-operations` (create,
  status `validating`) → `POST /bulk-operations/:id/rows` **repeatedly** (chunked
  ingest, server re-validates + normalizes) → `POST …/confirm` (duplicate-phone
  **last-wins**, enqueue) → poll `GET …/:id`. Idempotent throughout: rows carry a
  unique `(operation_id, row_number)` and insert with `INSERT IGNORE`; op
  counters increment by *actually inserted* rows.
- **Row ingest is the one route that fans out** — one CSV upload becomes
  `ceil(rows/500)` POSTs, so it has a **dedicated 300/min rate-limit bucket**
  (`BULK_INGEST_RE` in `apps/backend/src/main.ts`), not the shared 20/min
  `/api/` write bucket. Client chunk size is 500 to stay inside Fastify's 1 MiB
  `bodyLimit` (`reason` is up to 500 chars).
- **Workers are flag-gated.** `BulkWorker` + `ExportsWorker` drain
  `loyalty-bulk-ops` / `loyalty-exports` only when `LOYALTY_WORKER_ENABLED=true`.
  Transient Core errors **throw** (no ack → SQS redelivery); permanent 4xx fail
  just that row. Crash-resume is `WHERE status='pending'`.
- **Debits pre-check the live Core balance** before any write, in both the worker
  and `POST /customers/:phone/adjust` — a doomed debit never reaches the ledger.
- **The leaderboard reads MIRROR balances, so freshness depends on the worker.**
  `MaintenanceWorker` ticks every 60 s (only when `LOYALTY_WORKER_ENABLED=true`)
  and resyncs ≤50 rows whose `balance_synced_at` is null or >24 h old from Core.
  Customer *search* is always live (it calls Core balance/history directly and
  refreshes that row); the leaderboard is eventually consistent. With the worker
  off, leaderboard balances only move when a row is otherwise touched.
- **Core owns program naming, order earning and coin valuation** — the app
  stores none of them (see the 2026-07-31 entry). The program label is the
  `LOYALTY_PROGRAM_NAME` constant; earning rules grant flat BONUS coins only.
- **QR claim v2 is signature-verified**, using a per-merchant claim-signing
  secret revealed/rotated through its own guarded endpoints. The secret is
  **never** part of the config input schema; config GET exposes only
  `claimSecretSet`.
- **Admin forms all render through `src/components/FieldRow.tsx`** — the single
  wrapper providing the required-field `*` marker and the inline
  `role="alert"` message. Do not reintroduce per-route private copies.

## Change journal

### 2026-07-31 — change — Core Loyalty reclaims program naming, earn rate and coin value
- **What:** Removed `programName`, `baseEarnRate` and `coinValueInr` from the
  app entirely (shared schema, config DTO/service, DB columns, admin Settings)
  because the Core Loyalty team owns them. Added the per-operation coin/customer
  totals and a row-level detail view to Bulk operations.
- **Why:** Merchant-editable copies of Core-owned values drift from Core and
  mislead — the QA screenshot showed *Coin value = 100* (₹100/coin), which
  overstated the liability tile ~1000×.
- **Definition of done / fix:** Three follow-on consequences, each handled
  rather than left implicit:
  1. **`programName` was load-bearing on a shipped contract** — the deployed
     `packages/loyalty-sdk` claim widget renders `Earn {points} {programName}`,
     and it also appears in QR poster captions and the public
     `/loyalty/public/config/:merchantId` payload. The field therefore STAYS on
     the wire, served from the new `LOYALTY_PROGRAM_NAME` constant in
     `@ratio-app/shared/schemas/loyalty-config`. Never accepted as input again.
  2. **MULTIPLIER earning rules are retired.** A multiplier's grant was
     `(m − 1) × orderTotal × baseEarnRate`; that rate was a local mirror of
     Core's, and Core exposes no endpoint to read it back (credit/debit/
     balance/history only — verified against the OpenAPI spec). Rules are now
     flat BONUS coins. `RuleEvaluatorService` skips legacy MULTIPLIER rows with
     a warning instead of awarding a guessed amount; the admin drops the rule-type
     choice, tags such rows `retired`, and warns on edit that saving converts
     them to a flat bonus. `loyalty_rule_applications.base_points` is now always
     0 (write-only column, read by nothing).
  3. **The `liabilityInr` dashboard tile is gone**, replaced by "Outstanding
     coins". `StatsService` no longer depends on `LoyaltyConfigService`.
  Migration `0003_drop_core_owned_config_columns.ts` drops the three columns;
  **deploy the code before the migration** (its `down()` restores the columns
  with their original defaults, but not the per-merchant values).
  Separately, for Bulk operations: `loyalty_bulk_operations.total_points`
  existed as a column that nothing wrote or exposed — `confirm()` now persists
  the winners' coin sum (post-last-wins, so it matches what is actually
  credited) and the summary returns it. The History table gained **Coins** and
  **Customers** columns, and a row click opens a detail modal backed by a new
  paginated `GET /bulk-operations/:id/rows` (`?status=` filter) showing every
  phone, amount, outcome and failure reason.
- **Files:** `packages/shared/src/schemas/loyalty-config.ts`;
  `modules/loyalty/config/config.service.ts`, `db/types.ts`,
  `db/migrations/0003_drop_core_owned_config_columns.ts`,
  `dashboard/stats.service.ts`, `dashboard/maintenance.worker.ts` (unchanged,
  see below), `webhooks/order-created.handler.ts`,
  `rules/rule-evaluator.service.ts`, `storefront/storefront-config.service.ts`,
  `qr/qr-claim.controller.ts`, `qr/qr.service.ts`, `bulk/bulk.service.ts`,
  `bulk/bulk.controller.ts`; admin `routes/{config,index,rules,bulk}.tsx`,
  `hooks/useLoyalty.ts`, `lib/queryKeys.ts`.
- **Links:** Core Loyalty OpenAPI (the four endpoints in
  `core-client/core-loyalty.client.ts`).

### 2026-07-31 — fix — QA blocker: CSV bulk credit/debit, plus form-validation UX
- **What:** Fixed the reported "unable to upload CSV for crediting/debiting"
  blocker and four related QA findings: sample-CSV template download, manual
  credit/debit alongside CSV upload, per-field validation messages, and
  asterisks on mandatory fields.
- **Why:** QA could not complete a bulk credit/debit at all, and the same report
  asked for a sample template — the pair of symptoms a silently-rejecting CSV
  parser produces. Investigation found four independent defects that each break
  or hide the flow, not one.
- **Definition of done / fix:** Five root causes, each fixed:
  1. **Parser rejected whole files silently.** `parseBulkCsv` was comma-only,
     BOM-naive, strictly positional, and rejected Excel's number formatting — a
     `;`-delimited, BOM-prefixed or column-reordered file put **every** row in
     `invalid`, left Confirm disabled, and explained nothing. Now auto-detects
     the delimiter (`,` `;` tab `|`, counting only outside quotes), strips the
     UTF-8 BOM, maps columns **by header name**, accepts `"1,000"` / `₹500` /
     `500.00` (while keeping `10.5` invalid), distinguishes missing from
     malformed cells, and renders per-row reasons inline plus a targeted
     field-level message for the empty / header-only / all-invalid cases.
  2. **Client/server phone validation had drifted.** The client accepted any
     10–13 digits while the server requires an Indian mobile, so rows passed the
     preview then failed server-side. The client now uses an exact port of
     `normalizePhone` and emits E.164 — which also fixed duplicate detection,
     since `9876543210` and `+919876543210` had been counted as two customers
     (inflating the "total coins" figure).
  3. **Rate limit cut uploads off mid-ingest.** Row ingest sat in the shared
     20-writes/min-per-IP bucket despite one upload deliberately fanning out
     into many POSTs, so anything past ~9,500 rows 429'd partway through against
     an advertised 50,000-row ceiling. Added `BULK_INGEST_RE` → 300/min,
     still **IP-keyed** (never merchantId-keyed — the S1 header-rotation bypass
     still cannot apply) and behind the merchant-token guard.
  4. **Oversized chunks 413'd opaquely.** 2,000 rows × a 500-char `reason` is
     ~1.1 MB against Fastify's 1 MiB `bodyLimit`. Client chunk 2000 → 500
     (~275 KB worst case). Both this and (3) now surface as actionable text
     instead of a raw envelope message.
  5. **Credited customers stayed invisible.** `firstSeenSource` `'bulk'` and
     `'manual'` were declared in `db/types.ts` but **never written by anything**:
     the bulk worker and manual adjust ran a mirror `UPDATE` that matched zero
     rows for a phone that had never ordered. Core held the coins; the customer
     appeared nowhere in the admin — indistinguishable from "the credit didn't
     work". Both paths now `ensurePhone(...)` + `applyAdjustedBalance(...)`.
  Also, per QA: a "Download sample CSV" button serving a template that is valid
  by construction (test-enforced); manual single-customer credit/debit as a mode
  on `/bulk` (reusing `POST /customers/:phone/adjust`); the Customers page no
  longer dead-ends on `CUSTOMER_NOT_FOUND` but offers to credit the phone
  anyway; `rules`/`qr`/`bulk`/`customers`/`export` moved from one lumped
  "X is invalid" bullet-list Alert to per-field messages; and mandatory fields
  are marked `*` via the new shared `FieldRow`.
- **Files:** `apps/admin-loyalty/src/lib/parse-csv.ts`,
  `src/components/FieldRow.tsx` (new), `src/routes/{bulk,customers,rules,qr,config,export}.tsx`,
  `src/index.css`; `apps/backend/src/main.ts` (`BULK_INGEST_RE`),
  `modules/loyalty/bulk/bulk.worker.ts`,
  `modules/loyalty/customers/customers.controller.ts`,
  `modules/loyalty/mirror/customer-mirror.service.ts` (`applyAdjustedBalance`).
  Tests: `parse-csv.test.ts` (34), `bulk.test.tsx` (14), `customers.test.tsx` (8),
  `rules.test.tsx` (8), `qr.test.tsx` (10); backend `bulk.worker.test.ts`,
  `customers.controller.test.ts`, `helpers/fake-loyalty-db.ts` (models
  `loyalty_customers` uniqueness so the INSERT IGNORE assertions are real).
- **Links:** PRD/TRD §2 (bulk operations), TRD §6 (queues), TRD §8 risk 2
  (one loyalty identity per customer).
