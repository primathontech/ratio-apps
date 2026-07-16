# PRD — Loyalty (Merchant Loyalty Admin)

> Structured from the source "Wellversed Loyalty App" PRD (AMJ-2026, P0). A **1P
> vendor app** built on top of Ratio's **Core Loyalty Service**. Core handles the
> loyalty primitives (earning on orders, redemption at checkout, balance, history,
> expiry, customer-facing display). This app adds the merchant-facing power tools
> Core does not have: **bulk coin credit/debit via CSV**, **cohort-based earning
> rules** (uploaded customer lists and dynamic segments), **QR codes for offline
> events**, **filtered data export**, **analytics dashboard**, and **customer
> search / leaderboard**.
>
> Wellversed is the first client, but the app is **generic** — any merchant on
> Ratio can install it. Per user decision the app is named **Loyalty** (not
> Wellversed). Coin naming ("coins" / "stars" / "points") comes from Core's
> `program_name` setting.
>
> **Build scope (decided GATE-0):** Phase 1 **and** Phase 2 of the source PRD —
> bulk CSV credit/debit, customer-list AND segment-based earning rules, QR
> create/scan flow, filtered export, customer search, dashboard, rule performance
> analytics, QR→order conversion tracking, and the customer leaderboard.
> Phase 3 (rule templates, branded QR, cohort analysis, bulk-op webhooks) is out
> of scope. API-based programmatic bulk credit and bulk-op scheduling from
> Phase 2 are deferred too (CSV-upload only in this build).

## Vendor name & slug

- **Display name:** Loyalty
- **Slug:** `loyalty`
- **Storefront SDK?** `no` — the QR scan landing page is a lightweight,
  mobile-optimized **public page served by the backend module** (like the OAuth
  callback), NOT a storefront widget. `hasStorefrontSdk: false`. (Decided GATE-0,
  resolving the source PRD's conflict between §4.3 "hosted by the app" and Open
  Question #1's storefront-redirect resolution.)

The slug drives every derived name: backend module
(`apps/backend/src/modules/loyalty/`), admin app (`apps/admin-loyalty/`), URL
prefix (`/loyalty/*`), and `RATIO_LOYALTY_*` env keys. Validated `^[a-z0-9-]+$`,
not present in the `APPS` tuple, and `apps/admin-loyalty/` does not exist — slug
is free.

### Dependency flag (carried to TRD / GATE 2)

Everything this app does runs through the **OS Loyalty & Membership Core
Service** (status: **in QA**) and the **Loyalty APIs** from the API-Parity PRD
(status: **draft**): points credit/debit, bulk-credit, balance, history,
customer filtering/export, and the **Points Multiplier Hook** extension point.
Scope names and endpoint shapes below come from the source PRD and could not be
validated against the platform docs at PRD time (doc lookup declined; APIs are
draft) — **the TRD must pin the real endpoint/scope names or record them as
pending**.

**Resolution for this build (mirrors the `wizzy`/`google` pattern):** all Core
Loyalty calls are isolated in a single guarded API client. Features degrade to a
clear `pending_api` status (no crash) when a Core endpoint is unavailable, so
the app ships now and lights up as Core lands. The app's own data (bulk-op
tracking, rules, QR codes, scans, exports, event log) lives in its own tables
and is buildable/testable unconditionally.

### Architecture decision — who owns earning rules

The source PRD both lists Core rules APIs (`POST /loyalty/rules` …) and
describes the app evaluating rules itself when Core fires the points-earning
pre-hook (§4.2). For this build: **the app is the source of truth for rule
definitions and customer lists** (own tables, own evaluation), and exposes a
**hook endpoint** that Core calls at earning time
(`POST /loyalty/hooks/points-earning` → returns multiplier/bonus). Registration
of that hook with Core goes through the guarded client (`pending_api` until the
extension point exists).

## Problem

Merchants on Ratio get loyalty primitives from Core, but no operating tools:

- No bulk coin operations — gifting 500 coins to 2,000 customers for a Diwali
  campaign means one-at-a-time admin edits or an engineering request.
- No differentiated earning — an influencer driving 50 referrals earns at the
  same rate as a first-time buyer; no way to reward cohorts with multipliers.
- Offline events (sampling booths, pop-ups, health expos — a core India D2C
  motion) generate zero loyalty data and zero offline-to-online attribution.
- No export/filtering — marketing can't pull "customers with 1,000+ coins" for
  a WhatsApp campaign.
- No analytics on the coins economy, rule performance, or QR effectiveness.

**Users:** merchant admins (marketing/ops teams — Wellversed first) in the admin
SPA; end customers only touch the public QR scan page. **Outcome:** merchant
installs the app → uploads a CSV to credit thousands of customers in one action
→ creates 3x-multiplier rules for influencer lists or dynamic segments →
prints QR codes for events whose scans credit coins (creating accounts for new
customers) → exports filtered customer lists → watches it all on a dashboard.

## Data model (tables / fields)

Beyond the standard `merchants`, `oauth_tokens` (Ratio OAuth), and `webhook_log`
tables every module already has. Phone numbers are stored E.164-normalized.
No vendor API secrets — Core is called with the app's Ratio OAuth token.

| Table | Column | Type | Notes |
|---|---|---|---|
| `loyalty_configs` | `merchant_id` | varchar(128) PK | FK → `merchants.id` |
| | `loyalty_enabled` | tinyint(1) default 0 | per-merchant kill switch |
| | `program_name` | varchar(64) NULL | cached from Core (display: "coins"/"stars") |
| | `coin_value_paise` | int NULL | cached from Core — liability calc (1 coin = ₹0.10 → 10) |
| | `hook_status` | enum(`active`,`pending_api`,`error`,`disabled`) default `disabled` | Points Multiplier Hook registration state (guarded) |
| | `created_at` / `updated_at` | datetime | |
| `loyalty_bulk_operations` | `id` | bigint PK auto | one CSV upload |
| | `merchant_id` | varchar(128) | FK → `merchants.id` |
| | `operation_type` | enum(`credit`,`debit`) | |
| | `status` | enum(`validating`,`awaiting_confirm`,`processing`,`completed`,`failed`,`cancelled`) | |
| | `file_name` | varchar(255) | uploaded CSV name |
| | `total_rows` / `valid_rows` / `invalid_rows` | int | preview counts |
| | `processed_rows` / `success_rows` / `failed_rows` | int | progress counters (resume support) |
| | `total_coins` | bigint | sum of valid amounts |
| | `created_at` / `completed_at` | datetime / NULL | |
| `loyalty_bulk_operation_rows` | `id` | bigint PK auto | per-row state → crash-safe resume + error CSV |
| | `operation_id` | bigint | FK → `loyalty_bulk_operations.id` |
| | `row_number` | int | position in the source CSV |
| | `phone_e164` | varchar(20) | normalized phone |
| | `amount` | int | coins (positive; sign comes from operation_type) |
| | `reason` | varchar(255) NULL | shown in Core coin history |
| | `status` | enum(`pending`,`success`,`failed`,`skipped`) | |
| | `error_reason` | varchar(255) NULL | "Customer not found", "Insufficient balance", … |
| | `customer_id` | varchar(128) NULL | resolved Ratio customer |
| | `processed_at` | datetime NULL | UNIQUE(`operation_id`,`row_number`) |
| `loyalty_rules` | `id` | bigint PK auto | earning rule |
| | `merchant_id` | varchar(128) | FK → `merchants.id` |
| | `name` | varchar(128) | display name |
| | `rule_type` | enum(`MULTIPLIER`,`BONUS`) | |
| | `value` | decimal(10,2) | multiplier (3.00) or bonus coins (200) |
| | `target_type` | enum(`SEGMENT`,`CUSTOMER_LIST`) | |
| | `conditions` | json NULL | SEGMENT: AND-joined condition array |
| | `event_trigger` | enum(`ORDER_COMPLETED`,`ALL_ORDERS`) default `ALL_ORDERS` | |
| | `starts_at` / `ends_at` | datetime / NULL | schedule window |
| | `active` | tinyint(1) default 1 | master toggle (pause) |
| | `priority` | int default 0 | highest priority wins per type |
| | `created_at` / `updated_at` | datetime | |
| `loyalty_rule_customers` | `id` | bigint PK auto | CUSTOMER_LIST membership (append-able) |
| | `rule_id` | bigint | FK → `loyalty_rules.id` |
| | `phone_e164` | varchar(20) | |
| | `customer_id` | varchar(128) NULL | resolved at upload time |
| | `added_at` | datetime | UNIQUE(`rule_id`,`phone_e164`) |
| `loyalty_rule_matches` | `id` | bigint PK auto | rule-performance analytics (Phase 2) |
| | `rule_id` | bigint | FK → `loyalty_rules.id` |
| | `merchant_id` | varchar(128) | |
| | `customer_id` | varchar(128) | |
| | `order_id` | varchar(128) NULL | |
| | `base_points` / `extra_points` | int | coins above base rate attributed to the rule |
| | `matched_at` | datetime | |
| `loyalty_qr_codes` | `id` | bigint PK auto | offline-event QR |
| | `merchant_id` | varchar(128) | FK → `merchants.id` |
| | `unique_code` | varchar(64) | random URL token — UNIQUE |
| | `event_name` | varchar(128) | |
| | `coins_per_scan` | int | |
| | `max_scans` | int default 0 | 0 = unlimited |
| | `starts_at` / `expires_at` | datetime | active window |
| | `landing_message` | varchar(255) NULL | custom scan-page copy |
| | `status` | enum(`DRAFT`,`ACTIVE`,`PAUSED`,`EXPIRED`) | |
| | `scan_count` / `new_account_count` | int default 0 | denormalized counters |
| | `created_at` / `updated_at` | datetime | |
| `loyalty_qr_scans` | `id` | bigint PK auto | one successful claim |
| | `qr_code_id` | bigint | FK → `loyalty_qr_codes.id` |
| | `merchant_id` | varchar(128) | |
| | `customer_id` | varchar(128) | |
| | `phone_e164` | varchar(20) | |
| | `is_new_account` | tinyint(1) | account created by this scan |
| | `converted_order_id` | varchar(128) NULL | first order ≤30d after scan (Phase 2 conversion) |
| | `scanned_at` | datetime | UNIQUE(`qr_code_id`,`customer_id`) — one scan per customer |
| `loyalty_exports` | `id` | bigint PK auto | export job history |
| | `merchant_id` | varchar(128) | FK → `merchants.id` |
| | `filters` | json | applied filter set |
| | `status` | enum(`processing`,`ready`,`failed`) | |
| | `row_count` | int NULL | |
| | `file_path` | varchar(512) NULL | generated CSV location |
| | `created_at` / `completed_at` | datetime / NULL | |
| `loyalty_event_log` | `id` | bigint PK auto | Core loyalty events cache → dashboard trends |
| | `merchant_id` | varchar(128) | |
| | `event_type` | enum(`points_earned`,`points_redeemed`,`points_expired`) | |
| | `customer_id` | varchar(128) | |
| | `points` | int | |
| | `source` | varchar(64) NULL | `order`, `bulk_upload`, `qr_scan`, … |
| | `occurred_at` | datetime | INDEX(`merchant_id`,`event_type`,`occurred_at`) |

## Scopes / permissions

Names follow the source PRD's intent mapped to Ratio's `read_*`/`write_*`
convention; **exact names must be pinned against the platform in the TRD**
(Loyalty APIs are draft):

- `read_loyalty` — read balances, history, loyalty-filtered customers (export,
  search, dashboard).
- `write_loyalty` — credit/debit points (bulk ops, QR claims, manual
  adjustments), register the points-earning hook.
- `read_customers` — look up customers by phone/email (CSV matching, QR claim,
  search).
- `write_customers` — create accounts for new customers in the QR scan flow.
- `read_orders` — QR→order conversion tracking (Phase 2 analytics).

## Webhook events

- `app/uninstalled` — flip merchant inactive, disable rules/QR claims,
  deregister the points-earning hook (guarded). (Default, wired by template.)
- `loyalty/points_earned` — append to `loyalty_event_log` (dashboard: coins
  issued, trends).
- `loyalty/points_redeemed` — append to `loyalty_event_log` (redeemed,
  redemption rate).
- `loyalty/points_expired` — append to `loyalty_event_log` (expired).
- `orders/create` — QR→order conversion: if the customer scanned a QR in the
  prior 30 days, stamp `converted_order_id` on the scan row (Phase 2).

Verification: HMAC-SHA256 over the raw body (template guard). The
`loyalty/*` topic names are draft — same guarded/pending treatment as the APIs.

**Inbound hook (not a webhook subscription):** `POST /loyalty/hooks/points-earning`
— Core calls this synchronously at earning time; the app evaluates active rules
(CUSTOMER_LIST membership, then SEGMENT conditions; highest priority wins per
type; one MULTIPLIER + one BONUS may stack) and returns `{multiplier, bonus}`.
Records a `loyalty_rule_matches` row for analytics.

## Public (unauthenticated) surface

- `GET /loyalty/qr/:unique_code` — mobile-optimized QR landing page
  (backend-rendered, works on desktop too). Shows event name, coins on offer,
  custom message; phone → OTP login.
- `POST /loyalty/qr/:unique_code/otp` + `POST /loyalty/qr/:unique_code/claim` —
  send/verify OTP (existing OS OTP service), enforce active-window / max-scans /
  one-scan-per-customer, create the customer if new (`write_customers`), credit
  coins via Core (`source: "qr_scan"`), record the scan. Rate-limited.

## Admin screens

- **Config** — enable toggle, cached program name / coin value display,
  hook-registration status card (Active / **Pending API** / Error / Disabled).
- **Dashboard (main)** — coins economy tiles (issued, redeemed, redemption rate,
  expired, outstanding liability, customers with coins), issued-vs-redeemed
  trend chart, rule-performance table, QR-performance table (scans, new
  accounts, order conversion), bulk-operations summary. Period picker: 7/30/90
  days + custom.
- **Bulk Operations** — credit/debit selector, CSV upload (template download),
  validation preview (total/valid/invalid rows, total coins, error CSV
  download), confirm → background processing with progress, history table,
  failed-rows CSV download.
- **Earning Rules** — list (name, type, target, value, status), create/edit
  form (MULTIPLIER/BONUS, value, SEGMENT condition builder or CUSTOMER_LIST CSV
  upload with append support, schedule, priority), detail view with performance
  (matches, extra coins, unique customers) and list management
  (view/download/append), pause/delete.
- **QR Codes** — list (event, coins, scans/max, status), create form (event
  name, coins per scan, max scans, active window, landing message), detail
  (QR image download PNG/PDF at 300/600/1200px, scan stats, new accounts,
  recent scans), pause/edit.
- **Export** — filter builder (balance, lifetime earned/redeemed/spend/orders,
  last order date, expiring coins, in-rule, QR-scanned; AND-joined), live match
  count + preview rows, export CSV (async for large sets), export history with
  downloads.
- **Customers** — search by phone/email/name → profile (balance, lifetime
  stats, active rules, QR scans, expiring coins, recent activity, manual
  credit/debit); **Leaderboard** tab — top customers by balance / lifetime
  earned, paginated.

## Acceptance criteria

- [ ] Merchant can save config; enable toggle persists; hook registration
      attempts against Core and records `pending_api` (no crash) when the
      extension point is unavailable.
- [ ] Bulk CSV upload validates format, normalizes phones to E.164, flags
      invalid rows with a downloadable error CSV, previews totals, and on
      confirm processes rows in the background via Core credit/debit calls —
      per-row status tracked, resumable after interruption, duplicates
      last-row-wins with warning, debit-below-zero and >100k amounts blocked.
- [ ] Earning rules CRUD works for both MULTIPLIER and BONUS with SEGMENT
      (AND-joined conditions) and CUSTOMER_LIST (CSV upload, append without
      replace, download) targets, schedule window, pause, and priority.
- [ ] The points-earning hook endpoint evaluates rules correctly: highest
      priority wins per type, one MULTIPLIER + one BONUS stack (multiplier
      first), inactive/out-of-window rules skipped, missing segment fields
      evaluate false; each match recorded for analytics.
- [ ] QR codes: create/pause/edit with window + max-scans; landing page serves
      publicly at `/loyalty/qr/:code`; OTP claim credits coins exactly once per
      customer, enforces window/limits with the specified messages, and creates
      accounts for new phone numbers; PNG/PDF downloads work.
- [ ] Export: AND-joined filters return a live count + preview; CSV downloads
      with the specified columns; large exports run as background jobs with
      history.
- [ ] Customer search by phone/email/name shows the loyalty profile (balance,
      history, rules, scans, expiring coins) with manual credit/debit;
      leaderboard paginates top customers.
- [ ] Dashboard shows coins economy, trends, rule performance, QR performance,
      and bulk-op summary for 7/30/90-day + custom periods, fed by the
      `loyalty/*` event log and app tables.
- [ ] `loyalty/points_earned|redeemed|expired` and `orders/create` webhooks
      (HMAC-verified) update the event log / conversion stamps; `app/uninstalled`
      flips the merchant inactive and disables the public QR surface.
- [ ] All Core Loyalty calls go through one guarded client that degrades to
      `pending_api` statuses without crashing when Core endpoints are absent.
- [ ] `pnpm -r lint && pnpm -r typecheck && pnpm -r build` pass.

## Out of scope

- **Loyalty primitives** — base earning on orders, redemption at checkout,
  balance/history display, expiry, stackability: Core Loyalty owns all of it.
- **Customer-facing storefront UI** — Core handles display; this app's only
  customer surface is the backend-served QR landing page.
- Tiers (Silver/Gold/Platinum) and paid membership programs — separate apps
  (see PlixKids Membership App).
- Phase 3 of the source PRD: rule templates, branded/custom QR designs, cohort
  analysis / rule ROI / attribution funnels, webhook notifications on bulk-op
  completion, custom rewards.
- API-based programmatic bulk credit and scheduled bulk operations — CSV upload
  via the admin only in this build.
- Scheduled/recurring exports (resolved: manual export only).
- OR logic in segment conditions (AND-only; OR = separate rules).
- Multi-scan per customer per QR (product decision: never).
- Gamification (badges, streaks), referral programs, UPI cashback redemption.
- Hindi / regional-language QR pages (resolved: English only).
- WhatsApp messaging — this app emits/records events; KwikEngage or another
  communication app owns messaging.
- Second-admin approval flow for bulk debits (resolved: single confirmation).
