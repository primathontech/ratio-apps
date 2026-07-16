# Jira tickets — Loyalty app build

> Draft ticket content for the human to create in Jira. One **Epic** with two
> child Stories: backend module + admin SPA. **No SDK ticket** —
> `hasStorefrontSdk: false` (the QR landing page is served by the backend, not
> a storefront bundle).
> Source of truth: `docs/agent/apps/loyalty/PRD.md` (GATE 1 approved).

---

## Epic — Loyalty app (1P merchant loyalty admin on Core Loyalty)

**Type:** Epic · **Priority:** P0 · **Quarter:** AMJ-2026 · **Labels:** `loyalty`, `ratio-apps`, `app-ecosystem`

### Summary

Build and ship the **Loyalty** vendor app (slug `loyalty`) in the `ratio-apps`
monorepo — a generic, installable 1P app that gives merchants the loyalty
operating tools Core Loyalty doesn't provide. First client: Wellversed
(unblocks their loyalty launch on Ratio). Scope: source-PRD Phase 1 + Phase 2.

### Business value

- Bulk coin credit/debit via CSV (campaign bonuses, corrections) — replaces
  engineering requests / one-at-a-time admin edits.
- Cohort-based earning rules (influencer 3x, VIP 2x) targeting uploaded
  customer lists or dynamic segments — no competitor (Smile.io, LoyaltyLion)
  offers list-based rule targeting.
- QR codes for offline events (sampling booths, expos, pop-ups) — unique
  offline-to-online loyalty attribution for the India D2C motion.
- Filtered export for WhatsApp/email campaign targeting.
- Analytics dashboard: coins economy, rule performance, QR effectiveness.

### Child stories

1. **[Backend]** Loyalty app — NestJS module `modules/loyalty` (Ticket 1)
2. **[Admin SPA]** Loyalty app — `apps/admin-loyalty` (Ticket 2)

### Definition of done (epic level)

- All PRD acceptance criteria met (`docs/agent/apps/loyalty/PRD.md`); TRD + TDD
  approved (GATEs 2–3); code reviewed, PR merged, deployed as a single
  artifact (backend serving the built admin).
- Core Loyalty integration behind the guarded client: app is fully functional
  in `pending_api` degradation mode and lights up as Core Loyalty (in QA) and
  the draft Loyalty APIs land.

### Dependencies / risks

- **OS Loyalty & Membership Core Service** — in QA; blocker for live loyalty
  behavior (not for the build itself).
- **Loyalty APIs (API-parity PRD)** — draft; endpoint + scope names pinned at
  TRD time or recorded as pending.
- Customer Service, OTP service — exist (low risk). App OAuth/install — in QA.

---

## Ticket 1 — [Backend] Loyalty app — NestJS module `modules/loyalty`

**Type:** Story (or Epic child) · **Priority:** P0 · **Labels:** `loyalty`, `backend`, `ratio-apps`

### Summary

Build the `loyalty` backend module (`apps/backend/src/modules/loyalty/`) — a 1P
merchant loyalty admin app on Ratio's Core Loyalty Service. Covers source-PRD
Phase 1 + Phase 2. All Core Loyalty calls go through one guarded API client that
degrades to `pending_api` (Core is in QA; Loyalty APIs draft).

### Scope of work

1. **Scaffold + wiring** — copy `_template` golden module → `loyalty`, register
   in `apps.ts` / `app.module.ts` / `.env.example` (`RATIO_LOYALTY_*`).
2. **DB migration** — 9 tables: `loyalty_configs`, `loyalty_bulk_operations`,
   `loyalty_bulk_operation_rows`, `loyalty_rules`, `loyalty_rule_customers`,
   `loyalty_rule_matches`, `loyalty_qr_codes`, `loyalty_qr_scans`,
   `loyalty_exports`, `loyalty_event_log` (see PRD data model).
3. **Guarded Core Loyalty client** — credit/debit/bulk-credit, balance, history,
   customer filter/export, hook registration; `pending_api` degradation, no crash.
4. **Config API** — enable toggle, cached program name / coin value, hook
   registration status.
5. **Bulk operations** — CSV upload + validation (E.164 normalization, amount
   1–100,000, duplicate last-row-wins warning, error CSV), preview, confirm →
   background per-row processing via Core (credit / balance-checked debit),
   crash-safe resume, progress + history endpoints, failed-rows CSV.
6. **Earning rules** — CRUD for MULTIPLIER/BONUS with SEGMENT (AND-joined
   conditions) and CUSTOMER_LIST (CSV upload, append, download) targets,
   schedule window, priority, pause. Rule-performance data from
   `loyalty_rule_matches`.
7. **Points-earning hook** — `POST /loyalty/hooks/points-earning`: evaluate
   active rules (list membership → segment conditions; highest priority wins per
   type; MULTIPLIER + BONUS stack, multiplier first; missing fields → false),
   return `{multiplier, bonus}`, record match.
8. **QR codes** — CRUD + status lifecycle (DRAFT/ACTIVE/PAUSED/EXPIRED), unique
   URL token, PNG/PDF generation (300/600/1200px). **Public surface** (rate
   limited): `GET /loyalty/qr/:code` mobile-optimized landing page,
   `POST .../otp` + `POST .../claim` (OS OTP service; enforce window / max
   scans / one-scan-per-customer; create customer if new; credit via Core with
   `source: "qr_scan"`).
9. **Export** — AND-joined filter builder (balance, lifetime stats, last order,
   expiring coins, in-rule, QR-scanned), live count + preview, async CSV job +
   history/download.
10. **Customer lookup + leaderboard** — search by phone/email/name → profile
    (balance, history, rules, scans, expiring coins, manual credit/debit);
    top-customers query, paginated.
11. **Dashboard data API** — coins economy tiles, issued-vs-redeemed trend,
    rule + QR performance, bulk-op summary; 7/30/90-day + custom periods from
    `loyalty_event_log` + app tables.
12. **Webhooks** (HMAC-verified) — `app/uninstalled` (default),
    `loyalty/points_earned|redeemed|expired` → event log, `orders/create` →
    QR→order conversion stamp (30-day window).

### Acceptance criteria

Per PRD "Acceptance criteria" section — plus backend tests per the TDD (GATE 3)
and `pnpm -r lint && pnpm -r typecheck && pnpm -r build` green.

### Dependencies

- OS Loyalty & Membership Core Service (in QA) — **blocker for live behavior**,
  not for the build (guarded client).
- Loyalty APIs parity PRD (draft) — endpoint/scope names pinned in TRD.
- Customer Service (exists), OS OTP service (exists), App OAuth/install (in QA).

---

## Ticket 2 — [Admin SPA] Loyalty app — `apps/admin-loyalty`

**Type:** Story (or Epic child) · **Priority:** P0 · **Labels:** `loyalty`, `frontend`, `ratio-apps`

### Summary

Build the merchant admin SPA (`apps/admin-loyalty/`, React 19 + Vite + TanStack
Router on the `_template-admin` shell) for the Loyalty app, talking to the
`/loyalty/*` backend APIs from Ticket 1.

### Screens

1. **Dashboard (landing)** — coins-economy stat tiles (issued, redeemed,
   redemption rate, expired, outstanding liability ₹, customers with coins),
   issued-vs-redeemed trend chart, rule-performance table, QR-performance table
   (scans, new accounts, order conversion), bulk-ops summary; period picker
   (7/30/90 days + custom).
2. **Bulk Operations** — credit/debit selector, CSV drop-zone + template
   download, validation preview (total/valid/invalid, total coins, error-CSV
   download), confirm → progress view, recent-uploads table with failed-rows
   CSV download.
3. **Earning Rules** — rules list; create/edit form (type MULTIPLIER/BONUS,
   value, target SEGMENT condition-builder or CUSTOMER_LIST CSV upload with
   append, schedule, priority); detail view with performance stats and list
   management (view/download/append); pause/delete.
4. **QR Codes** — list (event, coins, scans/max, status); create/edit form
   (event name, coins/scan, max scans, window, landing message); detail with QR
   image downloads (PNG/PDF), scan stats, new-accounts count, recent scans;
   pause.
5. **Export** — filter builder (AND-joined), live match count + preview table,
   Export CSV action, export history with download links.
6. **Customers** — search (phone/email/name) → profile card (balance, lifetime
   stats, active rules, QR scans, expiring coins, recent activity, manual
   credit/debit actions); Leaderboard tab (sort by balance / lifetime earned,
   paginated).
7. **Config** — enable toggle, program-name / coin-value display, hook status
   card (Active / Pending API / Error / Disabled) with explainer.

### Acceptance criteria

- All screens function against the backend APIs; `pending_api` states surfaced
  clearly (no blank/error screens when Core endpoints are absent).
- Admin tests per the TDD; `pnpm -r lint && pnpm -r typecheck && pnpm -r build`
  green; admin builds to static and is served by the backend (single artifact).

### Dependencies

- Ticket 1 (backend APIs) — screens bind to its routes.

---

## SDK ticket — not needed

`hasStorefrontSdk: false`. The only customer-facing surface is the QR landing
page, which the **backend** serves publicly at `/loyalty/qr/:code` (part of
Ticket 1). No `packages/loyalty-sdk`, no storefront bundle, no third ticket.
