# TDD — Loyalty (`loyalty`)

> Test Plan / Test-Driven Design. Produced by `tdd-author` from the approved TRD,
> then human-approved at **GATE 3** before any scaffolding. The builders write
> these tests first (failing), then implement to green.

**Source PRD/TRD:** `docs/agent/apps/loyalty/PRD.md`, `TRD.md`
**Status:** draft

## 1. Test strategy

- **Runner:** Vitest everywhere. Backend unit tests in
  `apps/backend/test/unit/apps/loyalty/*.test.ts` (wizzy layout); admin tests
  co-located `apps/admin-loyalty/src/routes/*.test.tsx`; SDK tests co-located
  `packages/loyalty-sdk/src/**/*.test.ts` (happy-dom, wizzy-sdk layout); shared
  schemas in `packages/shared/src/schemas/*.test.ts`.
- **Unit-tested with fakes:** all services/handlers/workers. Mocks: Core Loyalty
  HTTP (in-memory ledger fake), GoKwik profile API (token→profile map), Kysely
  DB (in-memory stubs per service contract, or query-builder assertion doubles —
  match existing wizzy tests), `RedisService` (in-memory Map fake incl.
  `firstSeen`/`allow`), `QueueService` (in-memory queue fake), `S3Service` /
  `EmailService` (recording fakes).
- **Integration-ish:** controller tests via Nest testing module with guards
  overridden; webhook dispatch tested through the handler contract
  (`{ topic, handle(data, merchantId, trx) }`).
- **Out of scope (boilerplate rule):** heavy e2e/QA, real MySQL/Redis/SQS/S3,
  live UAT calls, the wellversed-2.0 wrapper widget PR (manual checklist in §7).

## 2. Acceptance criteria → test mapping

| PRD acceptance criterion | Test case(s) |
|---|---|
| Config save round-trips (program name, earn rate, coin value, storefront URL) | `config.service.test.ts#saves-and-returns-config`, `#odku-preserves-on-reinstall`; admin `config.test.tsx#submits-valid-form` |
| `app/uninstalled` flips merchant inactive | `app-uninstalled.handler.test.ts#soft-deletes-merchant` |
| Bulk credit N rows → N Core calls, unique deterministic idempotency keys; re-run credits nothing twice; summary + failed CSV | `bulk.worker.test.ts#processes-rows-with-bulk-opid-rowno-keys`, `#rerun-same-op-is-noop`, `bulk.service.test.ts#error-csv-contains-failed-rows` |
| Bulk debit pre-checks balance; shortfall rows fail without Core call | `bulk.worker.test.ts#debit-insufficient-balance-skips-core-call` |
| Worker crash resume = pending rows only | `bulk.worker.test.ts#resume-processes-only-pending-rows` |
| MULTIPLIER 3.0 list rule on `orders/create` credits exactly (3−1)×base extra with `rule:{ruleId}:{orderId}`; duplicate webhook no double credit | `order-created.handler.test.ts#credits-multiplier-delta-once`, `#redelivery-is-noop-via-unique-rule-order` |
| SEGMENT rules evaluate nested AND/OR trees; priority per type; MULT+BONUS stack | `condition-tree.test.ts` (all), `rule-evaluator.test.ts#priority-wins-per-type`, `#multiplier-and-bonus-stack` |
| Rule eval reads Redis on hit (zero rule SQL), invalidates on mutation, DB fallback when Redis down | `rule-cache.test.ts#cache-hit-skips-db`, `#mutation-invalidates`, `#redis-down-falls-back-to-db` |
| QR claim: token→verified phone via GoKwik; once per phone; `already_claimed`; terminal states; client phone never accepted; unknown phones → new-to-loyalty mirror rows | `qr-claim.controller.test.ts#claims-once-per-phone`, `#second-claim-already-claimed`, `#expired-paused-fully-claimed-states`, `#rejects-body-phone-field`, `#invalid-token-invalid_session`, `#new-phone-creates-mirror-row-flagged-qr` |
| QR poster PNG (300/600/1200) + PDF encode `{storefront_base_url}/?loyalty_qr={code}` | `qr.service.test.ts#poster-png-encodes-claim-url-all-sizes`, `#poster-pdf-embeds-png` |
| SDK size budgets; loader detects `?loyalty_qr`, lazy-loads widget; status→login→claim flow | `loader.test.ts#noop-without-param`, `#self-init-with-param`, `#wrapper-init-api`, `claim-widget.test.ts#full-claim-flow`; size-limit in `packages/loyalty-sdk/.size-limit.json` (build gate) |
| Export CSV lands in S3, presigned download; >10k rows requires email, link emailed, `emailed_at` stamped | `exports.worker.test.ts#uploads-gzip-csv-to-s3`, `#emails-presigned-link-when-email-set`, `exports.controller.test.ts#rejects-over-10k-without-email`, `#download-302-presigned` |
| Dashboard tiles + trend from `loyalty_daily_stats`; rule + QR (incl. conversion) tables | `stats.service.test.ts#summary-tiles`, `#trend-series`, `#qr-table-includes-conversion`, `daily-snapshot.job.test.ts#writes-daily-row`, `#redis-lock-prevents-double-run` |
| Customer search: mirror + live Core balance/history refresh | `customers.controller.test.ts#profile-merges-mirror-and-live-core`, `#profile-refreshes-mirror-balance` |
| One guarded Core client: retry/idempotency, 401 refresh, errors surfaced never swallowed | `core-loyalty-client.test.ts#retries-429-5xx-with-backoff`, `#401-refreshes-once-then-retries`, `#4xx-maps-to-typed-error`, `#never-logs-response-body` |
| `pnpm -r lint && pnpm -r typecheck && pnpm -r build` pass | §8 green gate (no dedicated test) |

## 3. Backend test cases (`apps/backend/test/unit/apps/loyalty/`)

**`normalize-phone.test.ts`** — `9876543210` → `+919876543210`; already-E.164
passthrough; strips spaces/dashes/`0` prefix; rejects <10/ >13 digits, alpha.

**`config.service.test.ts`** — save→get round-trip; INSERT…ODKU preserves
existing row on reinstall (bootstrap contract); defaults endpoint returns shared
schema defaults; unknown merchant → 404.

**`core-loyalty-client.test.ts`** — credit/debit send `phone/points/
idempotency_key/description/metadata`, Bearer = stored merchant token;
`#retries-429-5xx-with-backoff` (2 retries then typed failure);
`#401-refreshes-once-then-retries` (second 401 → error, no loop);
`#4xx-maps-to-typed-error` (400/404 no retry); balance/history parse via Zod,
malformed body → typed error; `#never-logs-response-body` (logger spy).

**`gokwik-identity-client.test.ts`** — valid token → `{phone,name,email}`
(headers `gk-access-token`, `gk-merchant-id` asserted); 401/403/500 →
`invalid_session`; timeout → `invalid_session`; token never appears in logs.

**`condition-tree.test.ts`** — leaf ops (`gt/gte/lt/lte/eq/neq/between`,
`before/after`); nested `(A OR B) AND C` truth table; short-circuit; missing
field ⇒ leaf false (PRD rule); order-scope fields read from order payload
(`order_total`, `item_count`, `is_first_order`); customer-scope from mirror row.

**`rule-evaluator.test.ts`** — `#priority-wins-per-type` (two MULTIPLIERs →
higher priority only); `#multiplier-and-bonus-stack`
(`extra = round((m−1)×total×rate) + bonus`); rounding at .5; inactive /
out-of-window rules excluded; CUSTOMER_LIST membership match (skips tree);
customer in list AND matching segment → single highest-priority winner per type;
no match ⇒ extra 0 ⇒ no Core call.

**`rule-cache.test.ts`** — `#cache-hit-skips-db` (DB spy not called);
miss → DB → `setJson` with TTL; `#mutation-invalidates` (create/update/status/
delete/list-append each `del()`); `#redis-down-falls-back-to-db` (null-client
RedisService); lists >10k phones not embedded (DB membership lookup path).

**`order-created.handler.test.ts`** — topic string `'orders/create'`;
`#upserts-mirror` (new phone insert; existing phone spend/orders/last_order_at
accumulate); `#credits-multiplier-delta-once` (Core fake asserts key
`rule:{ruleId}:{orderId}`, metadata); `#redelivery-is-noop-via-unique-rule-order`
(duplicate insert → no second Core call); `#stamps-qr-conversion-within-30d`
(+ ignores scans older than 30d); Core failure → handler throws (webhook retry
contract); no-phone order → mirror skip, no crash.

**`order-cancelled.handler.test.ts`** — decrements spend/orders; floors at 0;
unknown phone no-op.

**`bulk.service.test.ts`** — create op → `validating` + ULID; row-chunk ingest
re-validates + normalizes, invalid rows stored `failed` with reason;
uq `(operation_id,row_number)` makes chunk retry idempotent;
`#dup-phone-last-wins` (earlier rows `skipped`, warning count returned);
confirm freezes totals → `processing` + enqueues `{opId,merchantId,rowIds}`
batches ≤500; confirm on non-`awaiting_confirm` status → 409;
`#error-csv-contains-failed-rows` (invalid + failed with reasons).

**`bulk.worker.test.ts`** — mirrors `sync-worker.test.ts`:
`#disabled-without-flag` (no consume when `LOYALTY_WORKER_ENABLED!=='true'`);
`#processes-rows-with-bulk-opid-rowno-keys`; `#rerun-same-op-is-noop`
(Core fake dedupes by idempotency key — second run adds 0 coins);
`#debit-insufficient-balance-skips-core-call` (balance fake, row `failed`
`Insufficient balance`); `#resume-processes-only-pending-rows`;
per-row failure isolates (other rows proceed; op counters correct);
op flips `done` when no pending remain; message not acked on thrown error.

**`qr.service.test.ts`** — create → unique 16-char base32 code, `DRAFT`→
`ACTIVE` on window start; status transitions (pause/resume, expiry);
`#poster-png-encodes-claim-url-all-sizes` (decode QR payload string equals
`{storefront_base_url}/?loyalty_qr={code}`; sizes 300/600/1200; invalid size →
400); `#poster-pdf-embeds-png`; loader snippet contains merchant id; scan
counters via atomic `SET x=x+1` (assert SQL shape / fake counter).

**`qr-claim.controller.test.ts`** — `GET status`: each state
(`active/not_started/expired/paused/fully_claimed`) from fixture QRs;
`POST claim`: happy path (GoKwik fake → phone; Core credit key
`qr:{qrId}:{phone}`; scan row `is_new_phone` correct);
`#claims-once-per-phone` (unique index violation → `already_claimed` + balance);
`#rejects-body-phone-field` (schema strips/rejects `phone` in body);
`#invalid-token-invalid_session`; max-scans reached → `fully_claimed` and no
Core call; rate-limit fake exceeded → 429; `#new-phone-creates-mirror-row-flagged-qr`.

**`exports.controller.test.ts`** — `#rejects-over-10k-without-email` (preview
count fake 10_001 → 422; ≤10k without email OK); create → job row + enqueue;
`#download-302-presigned` (fresh presign per call, 15-min expiry arg);
download before `completed` → 409.

**`exports.worker.test.ts`** — `#uploads-gzip-csv-to-s3` (key
`loyalty/exports/{merchantId}/{exportId}.csv.gz`; gunzip → header + filtered
rows); filters translate to mirror query (balance>, spend between, in-rule,
scanned-QR); `#emails-presigned-link-when-email-set` (EmailService recording
fake; 7-day expiry; `emailed_at` stamped); no email → no send, no stamp;
S3 failure → job `failed`, message not acked.

**`customers.controller.test.ts`** — filter matrix on mirror (each operator +
AND combination); pagination default 20 / max 100 clamp; leaderboard sort by
balance & lifetime_earned; `#profile-merges-mirror-and-live-core` (Core fake
balance+history in response); `#profile-refreshes-mirror-balance`
(`balance_synced_at` updated); manual adjust → Core call `manual:{ulid}`,
debit > balance → 422 before Core.

**`stats.service.test.ts`** — `#summary-tiles` (issued/redeemed/rate/expired/
liability = outstanding×coin_value/customers-with-coins from seeded daily rows);
`#trend-series` (from/to filtering, gap days zero-filled);
`#qr-table-includes-conversion` (scans, new phones, converted count+rate);
rules table (matches/extra/unique from `loyalty_rule_applications`); bulk
summary aggregates.

**`daily-snapshot.job.test.ts`** — `#writes-daily-row` (mirror + activity →
correct deltas); `#redis-lock-prevents-double-run` (`firstSeen` false ⇒ skip);
idempotent re-run same date (upsert, not duplicate).

**`storefront.controller.test.ts`** — serves loader/claim bundles from
`packages/loyalty-sdk/dist` memoized (fs read once); CORS `*` headers;
`GET config/:merchantId` returns redacted `{programName, enabled}` only (no
tokens/emails); unknown merchant → 404.

**`migration.test.ts`** — `0001_initial` up() creates the 3 standard + 11 app
tables with PKs/uniques (against the migration runner's dry harness or schema
introspection fake, matching existing repo migration tests if present; else
assert exported table list).

**Module wiring** — extend `module-registry.test.ts` expectations (`loyalty` in
`APPS` ↔ registry) — the existing load-time assertion test must stay green.

## 4. Frontend test cases (`apps/admin-loyalty/src/routes/`)

- **`config.test.tsx`** — renders prefilled from GET; zod-invalid earn rate /
  URL blocks submit with message; valid submit PUTs shared-schema payload;
  save success/failure states.
- **`index.test.tsx` (dashboard)** — tiles render from summary API; period
  picker refetches (7/30/90/custom); trend chart receives series; rule/QR/bulk
  tables render rows; empty state.
- **`bulk.test.tsx`** — CSV client-parse: valid/invalid counts + total coins
  preview; duplicate-phone warning; invalid-rows CSV download; confirm posts
  chunks then confirm endpoint; progress polling renders processed/total;
  history table + failed-CSV link.
- **`rules.test.tsx`** — condition-tree builder emits schema-valid JSON (AND/OR
  group add/remove, field-operator options constrained by registry); MULTIPLIER
  vs BONUS value labels; customer-list upload append flow; pause/delete actions;
  performance panel renders.
- **`qr.test.tsx`** — create form validation (window, max scans ≥ 0); detail
  renders poster PNG/PDF links + copy-snippet; scan list pagination; pause.
- **`export.test.tsx`** — filter builder rows; preview count display;
  **email field appears + required when count > 10,000**; export posts filters
  (+email); history renders status + download link enabled on `completed`.
- **`customers.test.tsx`** — search by phone renders profile (balance, rules,
  QR scans, activity); manual credit/debit dialog validates positive amount;
  leaderboard tab sort toggle + pagination.

## 5. Shared-schema test cases (`packages/shared/src/schemas/`)

- **`loyalty-config.test.ts`** — accepts minimal valid input (defaults applied:
  programName 'Coins', earnRate 1, coinValue 0.1); rejects: empty programName,
  ≤0/oversized earnRate & coinValue, non-URL `storefrontBaseUrl`, invalid
  `exportEmail`; coercion: `"2"` → 2.
- **`loyalty-rule-condition.test.ts`** — accepts single leaf; nested AND/OR
  tree; `between` tuple. Rejects: depth > 5; > 30 leaves; unknown field;
  operator not allowed for field type (`contains` on numeric, `gt` on enum);
  `between` without tuple; empty `children`.

## 6. Fixtures & helpers (`apps/backend/test/unit/apps/loyalty/helpers/`)

- `fixtures.ts` — merchant row, config row, mirror-customer factory
  (`mkCustomer(overrides)`), rule factory (`mkRule` — multiplier/bonus/list/
  segment variants), QR factory (per state), bulk op + rows factory, order
  webhook envelope factory (slash topics, phone/total/items), daily-stats rows.
- `fake-core-loyalty.ts` — in-memory phone→balance ledger honoring
  `idempotency_key` (dedupe map), scriptable failures (429/500/401 sequences).
- `fake-gokwik.ts` — token→profile map + failure modes.
- `fake-redis.ts` — Map-backed `RedisService` contract (`getJson/setJson/del/
  allow/firstSeen`) + `disabled` variant (all no-ops/null).
- `fake-queue.ts` — in-memory `sendBatch/receive/ack` with visibility no-op.
- `fake-s3.ts` / `fake-email.ts` — recording fakes (`puts[]`, `sends[]`,
  presign returns deterministic URL).
- SDK: happy-dom + `stubKwikpassStorage(token)` helper; fetch mock per endpoint.

## 7. Deployment contract checks

- [ ] PRD, TRD §7, and `STATE.json.deployment` all say `apiPlacement: shared`,
      `workerPlacement: shared-api` (assert in a `deployment-contract.test.ts`
      reading STATE.json, or reviewer checklist).
- [ ] Worker gate tests exist and pass: `bulk.worker.test.ts#disabled-without-flag`
      (+ analogous exports/maintenance worker gate cases) — start only when
      `LOYALTY_WORKER_ENABLED==='true'`, stop on `onModuleDestroy` (mirror
      `worker.stop.test.ts`).
- [ ] `hasStorefrontSdk: true` — `packages/loyalty-sdk` builds; backend serves
      its `dist` (storefront.controller tests); size-limit budgets enforced.
- [ ] Manual (outside CI): wellversed-2.0 `LoyaltyClaim` wrapper PR follows the
      `storefront-widget` skill checklist; storefront origin present in
      `ALLOWED_ORIGINS` of the deployed env.

## 8. Definition of done

- [ ] `pnpm verify` green (lint → typecheck → test → build, per `AGENTS.md`).
- [ ] Every §2 acceptance criterion has its named test(s) implemented and passing.
- [ ] Zero `// TEMPLATE:` markers remain in `modules/loyalty/`,
      `apps/admin-loyalty/`, `packages/loyalty-sdk/`.
