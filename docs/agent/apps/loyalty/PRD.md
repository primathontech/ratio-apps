# PRD — Loyalty

> Structured from the "Wellversed Loyalty App" source PRD (v1.0, 2026-04-22) and
> grounded against the **live UAT OS-ecosystem OpenAPI spec**
> (`https://uat-os-ecosystem.dev.gokwik.io/api/docs-json`, fetched 2026-07-20).
> Wellversed is the first client; the app is generic — any merchant can install it.

## Vendor name & slug

- **Display name:** Loyalty
- **Slug:** `loyalty`
- **Storefront SDK?** `yes` — the QR claim UI ships as a storefront widget
  (`packages/loyalty-sdk`, golden path `packages/_template-sdk` / reference
  `packages/wizzy-sdk`): a tiny loader script the merchant storefront includes
  once; when the QR query param is present the widget renders the claim overlay
  (Shadow DOM), drives KwikPass login, and calls the app's public claim API.
  Same delivery model as the osapp-freq-bought widget SDK, but on this repo's
  native `/loyalty/sdk/*` serving path.
- **API placement:** `shared`
- **Worker placement:** `shared-api`
- **Placement rationale:** Admin CRUD traffic is low; QR scan bursts at offline
  events are hundreds/day. Bulk CSV processing (≤ 50,000 rows) and async exports
  run through core SQS with a lightweight module-local consumer gated by
  `LOYALTY_WORKER_ENABLED`, running in the shared API pods — same pattern as the
  Wizzy sync worker. No isolation, secret, or latency need justifies dedicated pods.

## Build scope decision (human-approved)

This build targets **source-PRD Phase 1 + Phase 2**: bulk CSV credit/debit,
earning rules (CUSTOMER_LIST **and** SEGMENT), QR offline events, filtered
export, customer search, leaderboard, analytics dashboard, rule performance,
QR→order conversion tracking. Phase 3 (rule templates, branded QR, webhook
notifications, cohort ROI analytics) is out of scope.

## Core API surface — ground truth (drives the whole design)

The live UAT spec exposes exactly **four** Core Loyalty endpoints:

| Endpoint | Notes |
|---|---|
| `POST /api/v1/loyalty/points/credit` | phone-keyed; `points` 1–100,000/txn; **`idempotency_key` required**; `description` + `metadata` |
| `POST /api/v1/loyalty/points/debit` | same shape; idempotent |
| `GET /api/v1/loyalty/points/{phone}/balance` | balance + lifetime earned / redeemed / expired / adjusted |
| `GET /api/v1/loyalty/points/{phone}/history` | paginated ledger |

The source PRD assumed Core APIs that **do not exist** in UAT: bulk-credit,
rules CRUD, points-multiplier hook, QR API, loyalty customer list/export,
customer create/search-by-phone, loyalty events. There is also **no loyalty
scope** in the platform's 147-scope catalog and **no loyalty webhook topics**
(available topics: `orders/*`, `products/*`, `app/uninstalled`).

Consequences — the app owns all of these itself:

1. **Bulk ops** = app iterates Core credit/debit row-by-row from an SQS-driven
   worker, with deterministic idempotency keys (`bulk:{opId}:{rowNo}`) so retries
   and resume-after-crash never double-apply.
2. **Earning rules** = app-owned tables + evaluation. With no Core hook, the app
   listens to the `orders/create` webhook, computes the **extra** coins a
   matching rule grants (multiplier delta over the configured base earn rate, or
   flat bonus) and credits that delta via Core with
   `metadata: { rule_id, order_id }`. Core keeps crediting the base earn
   independently; the app never double-credits base.
   **Rule evaluation reads from Redis, not MySQL**: the per-merchant active rule
   set (definitions + CUSTOMER_LIST membership) is cached via the core
   `RedisService` (`core/cache/redis.service.ts`) and invalidated on every rule
   create/update/pause/delete/list-append, so per-order evaluation does not hit
   the DB. MySQL remains the source of truth; per the core Redis contract the
   evaluator falls back to a DB read when Redis is unavailable.
3. **QR codes** = app owns the campaign entity, scan ledger, one-scan-per-phone
   enforcement, and a **downloadable printable poster** (PNG/PDF with the QR).
   The QR encodes `{storefront_base_url}/?loyalty_qr={code}` — any storefront
   page. The **loyalty claim widget** (`packages/loyalty-sdk`, loaded once via
   script tag in the storefront) detects the param, fetches campaign status,
   renders a mobile-first claim overlay, and drives the existing **KwikPass
   phone+OTP** login (`window.handleCustomLogin` + `user-loggedin` event). It
   then calls the app's public claim API with the KwikPass `gk-access-token`;
   the app verifies the token against the GoKwik customer-profile API to resolve
   the **verified** phone, then credits via Core with
   `metadata: { qr_code_id, event_name }`. Loyalty is phone-keyed, so a scan by
   an unknown phone still earns coins — "new accounts" is reframed as
   "new-to-loyalty phones." The app hosts **no page and no OTP infrastructure**.
   Storefront integration follows the **FBT (SDK) widget flow** already live in
   wellversed-2.0: a `LoyaltyClaim` Shopkit widget wrapper (registry entry +
   root-template placement) lazy-loads the SDK and bridges KwikPass login —
   **this wrapper PR is in scope** as a build deliverable (separate repo).
4. **Export / search / leaderboard / dashboard** = app maintains a per-merchant
   **local customer mirror** (`loyalty_customers`) built from order webhooks, bulk
   uploads, and QR scans, with balances/lifetime stats refreshed from the Core
   balance endpoint by a periodic worker sweep + on-demand refresh. All filtering
   runs on the mirror; per-customer live data is fetched from Core at view time.
   Export CSVs are generated in the background, **uploaded to S3**, and served to
   the admin via short-lived presigned download links; when the row count exceeds
   **10,000**, the export dialog requires an email address (pre-filled from
   config) and the download link is **emailed** on completion.
5. **Dashboard trends** = daily snapshots into `loyalty_daily_stats` (deltas of
   the mirror's lifetime counters + the app's own credit/debit activity). No Core
   event stream exists, so trends have snapshot granularity, not real-time.
6. **QR claim identity** = KwikPass (already live on the Wellversed storefront)
   performs phone+OTP verification. The app's claim endpoint accepts the
   customer's KwikPass `gk-access-token` and resolves the verified phone by
   calling the GoKwik customer-profile API server-side — client-supplied phone
   numbers are never trusted, and the app needs **no SMS/OTP provider at all**.

## Problem

Merchants running loyalty on Ratio Core can earn/redeem/expire points, but have
no admin tooling on top: no bulk credit/debit for campaigns (Diwali bonus to
2,000 customers = 2,000 manual edits), no differentiated earning for influencer
or VIP cohorts, no way to bring offline events (sampling booths, expos, pop-ups)
into the loyalty funnel, no export of "customers with 1,000+ coins" for WhatsApp
campaigns, and no analytics on what's working. Users are merchant marketing/ops
admins (Wellversed first); offline-event customers interact only with the public
QR scan page.

## Data model (tables / fields)

Beyond the standard `merchants`, `oauth_tokens`, `webhook_log`:

| Table | Column | Type | Notes |
|---|---|---|---|
| `loyalty_configs` | `merchant_id` | varchar(128) PK | FK → `merchants.id` |
| | `program_name` | varchar(64) | display name for points ("Wellversed Coins") |
| | `base_earn_rate` | decimal(10,4) | coins per ₹1 — needed to compute multiplier deltas |
| | `coin_value_inr` | decimal(10,4) | ₹ per coin — liability metric |
| | `storefront_base_url` | varchar(255) | QR claim URLs are minted against this (e.g. `https://wellversed.in`) |
| | `export_email` | varchar(255) | default recipient for large-export links |
| `loyalty_customers` | `merchant_id`+`phone` | varchar PK (composite) | E.164-normalized phone |
| | `name`, `email` | varchar | from order webhooks |
| | `points_balance` | int | cached from Core |
| | `lifetime_earned` / `lifetime_redeemed` / `lifetime_expired` / `lifetime_adjusted` | int | cached Core lifetime stats |
| | `lifetime_spend` | decimal(14,2) | accumulated from order webhooks |
| | `lifetime_orders` | int | accumulated from order webhooks |
| | `last_order_at` | datetime | |
| | `first_seen_source` | varchar(16) | `order` \| `bulk` \| `qr` |
| | `balance_synced_at` | datetime | staleness marker for sweep |
| `loyalty_bulk_operations` | `id` | char(26) PK (ULID) | |
| | `merchant_id`, `type` (`credit`\|`debit`), `status` (`validating`\|`awaiting_confirm`\|`processing`\|`done`\|`failed`), `file_name`, `total_rows`, `valid_rows`, `invalid_rows`, `processed_rows`, `success_count`, `failure_count`, `total_points` | | progress + summary |
| `loyalty_bulk_operation_rows` | `id` bigint PK; `operation_id` FK, `row_number`, `phone`, `points`, `reason`, `status` (`pending`\|`success`\|`failed`\|`skipped`), `error_reason`, `core_transaction_id`, `processed_at` | | per-row resume + error CSV |
| `loyalty_rules` | `id` | char(26) PK | |
| | `merchant_id`, `name`, `rule_type` (`MULTIPLIER`\|`BONUS`), `value` decimal(10,2), `target_type` (`SEGMENT`\|`CUSTOMER_LIST`), `conditions` json (**condition tree**: nested AND/OR groups of `{field, operator, value}` leaves), `starts_at`, `ends_at` nullable, `active` bool, `priority` int | | dynamic engine — see "Earning Rules" screen |
| `loyalty_rule_customers` | `rule_id`+`phone` PK, `added_at` | | appendable list (resolved Q6) |
| `loyalty_rule_applications` | `id` bigint PK; `merchant_id`, `rule_id`, `order_id`, `phone`, `base_points`, `extra_points`, `applied_at` | | rule-performance analytics; unique (`rule_id`,`order_id`) |
| `loyalty_qr_codes` | `id` | char(26) PK | |
| | `merchant_id`, `code` varchar(32) unique, `event_name`, `points_per_scan`, `max_scans` (0 = ∞), `starts_at`, `expires_at`, `landing_message`, `status` (`DRAFT`\|`ACTIVE`\|`PAUSED`\|`EXPIRED`), `scan_count`, `new_phone_count` | | |
| `loyalty_qr_scans` | `id` bigint PK; `qr_code_id`, `merchant_id`, `phone`, `is_new_phone` bool, `core_transaction_id`, `scanned_at` | | unique (`qr_code_id`,`phone`) enforces one scan/customer |
| `loyalty_exports` | `id` char(26) PK; `merchant_id`, `filters` json, `status`, `row_count`, `s3_key`, `email` nullable, `emailed_at` nullable, `created_by`, `completed_at` | | async export jobs; CSV lives in S3, downloads via presigned URL |
| `loyalty_daily_stats` | `merchant_id`+`stat_date` PK; `points_issued`, `points_redeemed`, `points_expired`, `bulk_credited`, `bulk_debited`, `qr_points`, `rule_extra_points`, `customers_with_balance`, `outstanding_points` | | daily snapshot for dashboard trends |

## Scopes / permissions

- `read_orders` — receive `orders/*` webhooks and read order data: builds the
  customer mirror (spend, order counts), triggers rule evaluation, powers
  QR→order conversion.
- `read_customers` — enrich mirror entries (name/email) via
  `GET /api/v1/customers/{id}` when order payloads carry a customer id.

No loyalty scope exists in the platform catalog; the four Core Loyalty
endpoints are called with the platform's API-key/merchant-header auth used by
1P services (exact auth mechanics confirmed in the TRD). `write_customers` is
**not** requested — no customer-create API exists and the QR flow doesn't need one.

## Webhook events

- `app/uninstalled` — flip merchant inactive (default template wiring).
- `orders/create` — (1) upsert `loyalty_customers` (phone, name, spend, order
  count); (2) evaluate active earning rules and credit the extra coins via Core
  (idempotency key `rule:{ruleId}:{orderId}`); (3) mark QR→order conversion if
  the phone scanned a QR in the prior 30 days.
- `orders/cancelled` — correct mirror spend/order counters (no coin clawback —
  coins are permanent once credited, per source-PRD edge-case table).

## Admin screens

- **Dashboard** (landing) — coins economy tiles (issued, redeemed, redemption
  rate, expired, outstanding liability ₹, customers with coins), 30-day
  issued-vs-redeemed trend from daily snapshots, rule-performance table, QR
  performance table, bulk-ops summary. Period picker: 7/30/90 days + custom.
- **Bulk Operations** — credit/debit toggle, CSV upload (≤ 50k rows, ≤ 5 MB;
  columns `phone_number, amount, reason?`), client-side validation preview
  (valid/invalid counts, error-CSV download, total coins), confirm → background
  processing with live progress, history table with per-run summary + failed-rows
  CSV. Duplicate phones: last row wins with warning. Debit rows exceeding balance
  fail with `Insufficient balance`.
- **Earning Rules** — list + create/edit/pause/delete. Rule form: name,
  MULTIPLIER/BONUS + value, target SEGMENT (**dynamic condition builder**:
  nested AND/OR groups over an extensible field registry — customer fields
  `lifetime_orders`, `lifetime_spend`, `points_balance`, `last_order_at`,
  `first_seen_source` **and order fields** `order_total`, `item_count`,
  `is_first_order` — e.g. "(spend > ₹50k OR orders ≥ 10) AND order_total >
  ₹1,000") or CUSTOMER_LIST (CSV upload, append supported, view/download list),
  schedule (start/end), priority. Detail view shows performance (matches, extra
  coins, unique customers). Conflict resolution: highest priority wins per type;
  one MULTIPLIER + one BONUS may stack (multiplier first).
- **QR Codes** — list + create/edit/pause. Form: event name, coins/scan, max
  scans, active window, claim message. Detail: **printable poster download**
  (PNG 300/600/1200 px + print-ready PDF; QR encodes
  `{storefront_base_url}/?loyalty_qr={code}`), scan counter, new-phone counter,
  recent scans, and the copy-paste loader `<script>` snippet for the storefront.
  The customer-facing claim UI is the `loyalty-sdk` widget (KwikPass login); the
  app exposes a public `status` endpoint (event name/coins/state for the overlay)
  and a public `claim` endpoint (KwikPass-token-verified) returning
  success/already-claimed/expired/fully-claimed.
- **Export** — filter builder (balance, lifetime earned/redeemed/spend/orders,
  last-order date, in-rule, scanned-QR; AND-joined), live match count + preview,
  async CSV generation to S3, presigned download links + recent-exports history;
  when the match count exceeds 10,000 the dialog asks for an email (pre-filled
  from `export_email`) and the link is emailed on completion.
- **Customers** — search by phone/email/name → profile (cached mirror + live
  Core balance/history pull), active rules, QR scans, recent activity, manual
  credit/debit with reason. Leaderboard tab: top customers by balance/lifetime
  earned, paginated.
- **Settings (Config)** — program name, base earn rate, coin value, storefront
  base URL (for QR claim links), export email (default recipient for large
  exports).

## Acceptance criteria

- [ ] Merchant can save config (program name, base earn rate, coin value,
  storefront base URL) and it persists and round-trips through the admin.
- [ ] `app/uninstalled` flips the merchant inactive.
- [ ] CSV bulk credit of N valid rows results in N Core credit calls with unique
  deterministic idempotency keys; a re-run of the same operation id credits
  nothing twice; progress/summary and failed-row CSV are downloadable.
- [ ] Bulk debit pre-checks balance and marks shortfall rows failed with
  `Insufficient balance` without calling Core for them.
- [ ] A worker crash mid-operation resumes from unprocessed rows only.
- [ ] Creating a MULTIPLIER 3.0 rule targeting an uploaded list, then receiving
  an `orders/create` webhook for a listed phone, credits exactly
  `(3.0 − 1) × base` extra coins with `rule:{ruleId}:{orderId}` idempotency;
  duplicate webhook delivery credits nothing twice.
- [ ] SEGMENT rules evaluate nested AND/OR condition trees against the mirror
  row + order payload; highest priority wins per type; MULTIPLIER + BONUS stack
  correctly.
- [ ] Rule evaluation on `orders/create` reads the active rule set from the
  Redis cache (no per-order MySQL rule query on cache hit); any rule mutation
  invalidates the merchant's cache; with Redis down, evaluation still works via
  DB fallback.
- [ ] QR claim API: a valid KwikPass token resolves the verified phone via the
  GoKwik profile API and credits once per phone per QR (`qr:{qrId}:{phone}`
  idempotency); a second claim returns `already_claimed` with balance;
  expired/paused/limit-reached QRs return the correct terminal states; a
  client-supplied phone is never accepted; claims by unknown phones create
  mirror entries flagged new-to-loyalty.
- [ ] QR poster downloads render the storefront claim URL
  (`{storefront_base_url}/?loyalty_qr={code}`) as PNG (300/600/1200) and PDF.
- [ ] `packages/loyalty-sdk` builds within size budgets; the loader detects
  `?loyalty_qr=`, lazy-loads the claim widget, and the widget completes the
  status → KwikPass login → claim flow against a running backend.
- [ ] Export with `points_balance > 1000` produces a CSV in S3 whose row set
  matches the mirror filter, downloadable via a presigned link from the admin;
  an export over 10,000 rows requires an email and the link is emailed on
  completion (`emailed_at` stamped).
- [ ] Dashboard tiles and 30-day trend render from `loyalty_daily_stats`; rule
  and QR performance tables render from app data.
- [ ] Customer search by phone shows cached mirror data plus live Core balance
  and paginated history.
- [ ] All Core Loyalty calls go through one client with retry + idempotency;
  Core 4xx/5xx surface as per-row/user-visible errors, never silent drops.
- [ ] `pnpm -r lint && pnpm -r typecheck && pnpm -r build` pass.

## Out of scope

- Tiers, paid memberships, referrals, gamification, custom rewards (sibling
  apps / P2 per source PRD).
- Customer-facing storefront UI (Core handles display; no storefront SDK).
- Base points earning, redemption at checkout, expiry logic (Core).
- Customer account creation (no platform API; loyalty is phone-keyed).
- App-hosted QR landing page and any SMS/OTP infrastructure (identity =
  storefront KwikPass; claim UI = the `loyalty-sdk` widget in this repo, plus
  the in-scope `LoyaltyClaim` wrapper widget PR in wellversed-2.0 — FBT-style,
  outside this monorepo's CI).
- Multi-scan per customer per QR (product decision: never).
- Scheduled/recurring exports; scheduled bulk operations.
- Real-time coins-economy metrics (no Core event stream — snapshot granularity).
- Phase 3: rule templates, branded QR, bulk-op webhooks, cohort ROI analytics.
- UPI cashback redemption; non-English claim page.
- `tags`-based segment conditions (no tag source exists in order webhooks/mirror
  yet — revisit when a platform customer-tags API ships).
