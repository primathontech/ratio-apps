# TRD — Loyalty (`loyalty`)

> Technical Requirements / Design Document. Produced by `trd-architect` from the
> approved PRD, then human-approved at **GATE 2** before the test plan is written.

**Source PRD:** `docs/agent/apps/loyalty/PRD.md`
**Status:** draft (rev 4 — claim UI = storefront widget SDK `packages/loyalty-sdk`;
exports = S3 + presigned links + email > 10k rows; rules = AND/OR condition trees)

> **v2 claim-identity amendment (2026-07-21).** The QR-claim identity flow below
> (rev 3) had the *backend* verify the KwikPass `gk-access-token` against the
> GoKwik customer-profile API to resolve the phone. That is **superseded**: the
> storefront BFF now owns KwikPass/GoKwik, resolves the verified phone itself,
> and forwards a **per-merchant HMAC-signed** request; our backend holds only the
> signing secret and verifies the signature (zero KwikPass/GoKwik). §2b and the
> `/qr/:code/claim` endpoint row are updated in place below; the authoritative,
> step-by-step v2 record is **`docs/agent/changes/loyalty-qr-claim-v2/PLAN.md`**.

Grounded against the live UAT spec (`https://uat-os-ecosystem.dev.gokwik.io/api/docs-json`):
Core Loyalty = `POST /api/v1/loyalty/points/credit`, `POST …/debit` (both require
`idempotency_key`, `points` 1–100,000, phone-keyed), `GET …/{phone}/balance`,
`GET …/{phone}/history`. All four are secured by the **`bearer` scheme (Merchant
JWT)** — the app calls them with the merchant's stored OAuth access token.

QR claim identity is grounded against the Wellversed storefront
(`wellversed-2.0`, Next.js App Router + Shopkit + **KwikPass** phone/OTP login).
**v2 (see the amendment banner above):** the KwikPass SDK issues a
`gk-access-token`; the *storefront BFF* — not our backend — calls the GoKwik
customer-profile API (`GET {customerApiBase}/v1/storefront/customers/profile`,
headers `gk-access-token` + `gk-merchant-id`) to resolve the verified phone, then
HMAC-signs it per-merchant and forwards it to our backend. Our backend verifies
the signature only and imports no KwikPass/GoKwik. Claim-UI delivery follows the
widget-SDK model (cf. `osapp-freq-bought`) using this repo's native third pillar:
`packages/_template-sdk` → `packages/loyalty-sdk`, reference `packages/wizzy-sdk`.

## 1. Module shape

Standard golden-path module at `apps/backend/src/modules/loyalty/`, scaffolded
from `_template` (tokens → `LOYALTY_CRYPTO/RATIO/MERCHANTS/OAUTH/WEBHOOKS` +
`LOYALTY_DB_TOKEN`; `kysely.module.ts` from `RATIO_LOYALTY_DATABASE_URL`;
`createAppProviders<LoyaltyDatabase>({ slug: 'loyalty', … })`; `exports: []`).
**`hasStorefrontSdk: true`** — the scaffolder also copies
`packages/_template-sdk` → `packages/loyalty-sdk` and wires `/loyalty/sdk/*`.

```
modules/loyalty/
  loyalty.module.ts            # imports LoyaltyKyselyModule; wires everything below
  loyalty.bootstrap.ts         # seeds loyalty_configs row on install (INSERT…ODKU)
  tokens.ts  guards.ts         # LoyaltyMerchantTokenGuard, LoyaltyWebhookSignatureGuard
  oauth/oauth.controller.ts    # template callback/install-session (unchanged pattern)
  config/                      # config.controller.ts, config.service.ts, loyalty-config.dto.ts
  core-client/
    core-loyalty.client.ts     # the vendor integration: RatioClient-based wrapper over the
                               #   4 Core endpoints; merchant JWT bearer; Zod response
                               #   schemas; timeout 5s; retry(2) with backoff on 429/5xx;
                               #   on 401 → one token refresh via shared OAuthService → retry
    claim-signature.service.ts # v2: verify(${merchantId}.${qr}.${phone}.${ts}, sig, secret)
                               #   HMAC-SHA256 hex, constant-time, ±5-min window (no GoKwik)
  merchants/merchants.controller.ts    # template merchant reads
  webhooks/
    topics.ts                  # 'app/uninstalled' | 'orders/create' | 'orders/cancelled'
    webhooks.controller.ts     # single POST guarded by signature guard (template)
    app-uninstalled.handler.ts
    order-created.handler.ts   # mirror upsert + rule evaluation + QR conversion mark
    order-cancelled.handler.ts # mirror counter correction
  mirror/customer-mirror.service.ts    # loyalty_customers upserts, balance refresh from Core
  rules/
    rules.controller.ts  rules.service.ts      # CRUD + list append + performance reads
    rule-cache.service.ts      # Redis cache of active rule set (core RedisService)
    condition-tree.ts          # condition-tree types + Zod schema + recursive evaluator
    rule-evaluator.service.ts  # target match (SEGMENT tree / CUSTOMER_LIST), priority,
                               #   multiplier+bonus stacking, extra-coins computation
  bulk/
    bulk.controller.ts  bulk.service.ts        # op lifecycle, chunked row ingest, error CSV
    bulk.worker.ts             # SQS consumer (loyalty-bulk-ops), gated LOYALTY_WORKER_ENABLED
    loyalty-queues.ts          # QUEUE_NAMES = { bulkOps: 'loyalty-bulk-ops', exports: 'loyalty-exports' }
  qr/
    qr.controller.ts  qr.service.ts    # admin CRUD, scan list, poster render (PNG via `qrcode`,
                                       #   PDF via `pdf-lib` embedding the PNG), loader snippet
    qr-claim.controller.ts     # PUBLIC: GET status + POST claim (KwikPass-token verified)
  storefront/
    storefront.controller.ts   # PUBLIC @Controller('loyalty/sdk'), CORS *: serves built
                               #   loyalty-loader.js / loyalty-claim.js from packages/loyalty-sdk/dist
                               #   (memoized), + GET config/:merchantId (redacted public config)
    storefront-config.service.ts
  exports/
    exports.controller.ts  exports.service.ts  # filter query, preview, job CRUD, presigned download
    exports.worker.ts          # SQS consumer (loyalty-exports): stream CSV → S3, email link > 10k
  customers/customers.controller.ts            # search, profile (mirror+live Core), manual credit/debit, leaderboard
  dashboard/
    dashboard.controller.ts  stats.service.ts  # tiles/trend/rule+QR tables (full PRD §4.5 scope)
    daily-snapshot.job.ts      # midnight-IST snapshot into loyalty_daily_stats (Redis-lock via firstSeen)
  db/types.ts  db/migrations/0001_initial.ts
```

**New shared `core/` primitives** (generalized per house-conventions, not
vendor-forked — first consumers: loyalty):

- `core/storage/s3.service.ts` — thin `@aws-sdk/client-s3` wrapper:
  `putObject(bucket, key, body, contentType)` +
  `presignGetUrl(bucket, key, expiresSeconds)` (via `@aws-sdk/s3-request-presigner`).
  Same env/IAM model as `QueueService` (endpoint override for local MinIO/none, pod
  IAM role in prod).
- `core/email/email.service.ts` — `@aws-sdk/client-sesv2` wrapper:
  `send({to, subject, html})` from `EMAIL_FROM`. Degrades to a logged no-op when
  `EMAIL_FROM` is unset (dev).

Workers follow `wizzy-sync.worker.ts` exactly: `OnModuleInit` checks
`LOYALTY_WORKER_ENABLED === 'true'`, long-poll loop via `core/queue/queue.service.ts`,
ack-on-success, un-acked → redelivery. Daily snapshot + balance sweep run in the
same gated loop (`MaintenanceWorker` interval tick) under a Redis
`firstSeen('loyalty:snap:<date>')` lock.

### The dynamic rules engine (condition trees)

`conditions` is a **tree**, validated by a recursive Zod schema in
`packages/shared` (shared with the admin's visual builder):

```ts
type ConditionLeaf = { field: FieldKey; operator: Op; value: number | string | [number, number] };
type ConditionNode = { op: 'AND' | 'OR'; children: (ConditionNode | ConditionLeaf)[] } | ConditionLeaf;
```

- **Field registry** (`condition-tree.ts`, extensible union):
  customer-scope — `lifetime_orders`, `lifetime_spend`, `points_balance`,
  `lifetime_earned`, `last_order_at`, `first_seen_source`;
  order-scope — `order_total`, `item_count`, `is_first_order`.
- **Operators:** `gt, gte, lt, lte, eq, neq, between` (numeric/date),
  `eq/neq` (string/enum), `before/after` (date); registry maps field → type +
  allowed operators; Zod rejects mismatches at save time.
- **Evaluation:** recursive short-circuit over `(mirrorRow, orderPayload)`.
  Missing field value ⇒ leaf `false`. Depth ≤ 5, ≤ 30 leaves (validated at save).
- **Selection:** among matching active in-window rules — highest-priority
  MULTIPLIER + highest-priority BONUS stack:
  `extra = round((mult − 1) × orderTotal × baseEarnRate) + bonus`.
- **CUSTOMER_LIST** targets skip the tree and match on `loyalty_rule_customers`.

## 2. API routes

Admin routes under `/loyalty/api` guarded by `LoyaltyMerchantTokenGuard` (`MT`);
`ZodValidationPipe` + `@CurrentMerchant()`. `PUB` = public (no guard,
rate-limited; the `/qr/*` claim routes are CORS-allowed for the storefront
origin, `/sdk/*` is CORS `*` like wizzy's).

| Method | Path (`/loyalty/...`) | Auth | Purpose |
|---|---|---|---|
| GET/PUT | `/api/loyalty-config` | MT | read/update config |
| GET | `/api/defaults` | PUB | public config defaults (template) |
| GET | `/api/v1/oauth/callback`, `GET/DELETE /api/v1/oauth/install/session` | — | template OAuth install flow |
| POST | `/api/v1/oauth/webhook` | HMAC | single webhook endpoint (signature guard) |
| POST | `/api/bulk-operations` | MT | create op `{type, fileName, totalRows}` → `{id}` (status `validating`) |
| POST | `/api/bulk-operations/:id/rows` | MT | chunked ingest `{rows:[{rowNumber,phone,points,reason?}]}` ≤ 2,000/call; server re-validates + E.164-normalizes; dup phone → last wins (earlier `skipped`) |
| POST | `/api/bulk-operations/:id/confirm` | MT | freeze totals → `processing`, enqueue row-batches to `loyalty-bulk-ops` |
| GET | `/api/bulk-operations` · `/:id` · `/:id/errors.csv` | MT | history / progress / failed-row CSV |
| GET/POST | `/api/rules` | MT | list / create rule (condition tree validated) |
| GET/PUT/DELETE | `/api/rules/:id` | MT | read / update / delete (cache invalidated on every mutation) |
| POST | `/api/rules/:id/status` | MT | `{active: boolean}` pause/resume |
| GET/POST/DELETE | `/api/rules/:id/customers` | MT | list / **append** / remove CUSTOMER_LIST phones |
| GET | `/api/rules/:id/performance` | MT | matches, extra coins, unique customers |
| GET/POST | `/api/qr-codes` | MT | list / create QR |
| GET/PUT | `/api/qr-codes/:id` | MT | detail / edit (incl. loader `<script>` snippet) |
| POST | `/api/qr-codes/:id/status` | MT | pause/activate |
| GET | `/api/qr-codes/:id/scans` | MT | scan list, paginated |
| GET | `/api/qr-codes/:id/poster.png?size=300\|600\|1200` | MT | printable QR PNG — encodes `{storefront_base_url}/?loyalty_qr={code}` |
| GET | `/api/qr-codes/:id/poster.pdf` | MT | print-ready PDF poster (event name + coins + QR) |
| GET | `/qr/:code/status` | PUB | claim-widget render data: `{eventName, points, programName, state}` (60/IP/min) |
| POST | `/qr/:code/claim` | PUB | **v2:** `{merchantId, phone, ts, sig}` → verify per-merchant HMAC `${merchantId}.${qr}.${phone}.${ts}` (constant-time, ±5-min window) + `merchantId==qr.merchantId` → window/max-scan/one-per-phone `(qr_code_id,phone)` checks → Core credit (`qr:{qrId}:{phone}`) → `{status:'credited', points, newBalance}` \| `{status:'already_claimed', balance}` \| terminal `invalid_signature`/etc. (10/IP/min; generic errors). No GoKwik — the storefront BFF resolved+signed the phone. |
| GET | `/sdk/loyalty-loader.js` · `/sdk/loyalty-claim.js` | PUB | built SDK bundles from `packages/loyalty-sdk/dist` (memoized; CORS `*`) |
| GET | `/sdk/config/:merchantId` | PUB | redacted public config `{programName, enabled}` |
| GET | `/api/customers` | MT | mirror query: filters (balance/earned/redeemed/spend/orders/last-order/in-rule/scanned-QR) + sort + pagination — export preview, leaderboard, search |
| GET | `/api/customers/:phone` | MT | profile: mirror row + **live** Core balance/history (refreshes mirror) |
| POST | `/api/customers/:phone/adjust` | MT | manual `{direction, points, reason}` → Core call (`manual:{ulid}`) |
| POST | `/api/exports` | MT | `{filters, email?}` — `email` **required when preview count > 10,000** (server-enforced) → job row, enqueue |
| GET | `/api/exports` · `/api/exports/:id` | MT | history / status |
| GET | `/api/exports/:id/download` | MT | 302 to a fresh S3 presigned URL (15-min expiry) |
| GET | `/api/dashboard/summary?from&to` | MT | tiles: issued, redeemed, redemption rate, expired, outstanding liability (₹, via `coin_value_inr`), customers-with-coins |
| GET | `/api/dashboard/trend?from&to` | MT | daily issued-vs-redeemed series from `loyalty_daily_stats` |
| GET | `/api/dashboard/rules` | MT | per-rule: matches, extra coins, unique customers (PRD §4.5) |
| GET | `/api/dashboard/qr` | MT | per-QR: scans, new phones, **conversion-to-order** count + rate (30-day window via `converted_order_id`) |
| GET | `/api/dashboard/bulk` | MT | bulk-ops month summary: customers touched, coins credited/debited |

### 2b. The claim widget — `packages/loyalty-sdk` + storefront wrapper (FBT flow)

Delivery replicates the **FBT (SDK) integration** already live in wellversed-2.0
(`src/widgets/common/FBT/V1/index.tsx` + `widget-registry.ts` entry
`WIDGET_TYPES.FBT`): app SDK exposes a window global with an `init` API; a
Shopkit React widget wrapper lazy-loads it and bridges storefront concerns via
window `CustomEvent`s. The generic, reusable version of this pattern is
codified in the **`storefront-widget` skill**
(`.claude/skills/storefront-widget/SKILL.md`) — future apps consult that skill
instead of re-exploring the storefront repo; loyalty is its worked example.

**Part 1 — `packages/loyalty-sdk` (this repo, third pillar).** Wizzy-sdk build
pattern (Lit 3 + Vite library mode, Shadow DOM, size-limit):

- **`loyalty-loader.js`** (IIFE, ≤ 4 KB) — exposes
  **`window.RatioLoyalty = { initClaim(containerId | null, config): cleanup }`**
  (FBT's `window.ProductBundler.initStandaloneFromLookup` shape; `null`
  container ⇒ overlay/modal mode). It also **self-inits in overlay mode** when
  `location.search` has `loyalty_qr` and no wrapper has claimed init — so a
  plain `<script src="{backend}/loyalty/sdk/loyalty-loader.js?store={merchantId}">`
  include works for any non-Shopkit storefront. Zero cost when the param is absent.
- **`loyalty-claim.js`** (IIFE, ≤ 12 KB, lazy-injected by the loader on init) —
  a Lit web component. **v2:** every API call the widget makes is **same-origin**
  to the merchant storefront's own BFF (`/api/loyalty/*`), never to our backend:
  1. `GET {origin}/api/loyalty/status?qr={code}` → renders event name, coins,
     program name (or terminal state), mobile-first, Shadow DOM.
  2. No KwikPass session → CTA dispatches **`loyalty:login:request`**
     (CustomEvent) and falls back to calling `window.handleCustomLogin(false)`
     directly; resumes on the **`user-loggedin`** window event; reads the token
     from the KwikPass storage keys (`KWIKUSERTOKEN` variants — the same keys
     `KwikpassLoginCustom.tsx` uses, centralized in one SDK module).
  3. `POST {origin}/api/loyalty/claim {qr, gkAccessToken}` → the storefront BFF
     resolves the verified phone and signs the request to our backend; renders
     credited / already-claimed / terminal state with the returned balance;
     dispatches **`loyalty:claim:success` / `loyalty:claim:error`**. A phone is
     never sent from the browser.
  4. Type-only imports from `@ratio-app/shared` — no Zod in the browser bundle.

**Part 2 — storefront wrapper widget (wellversed-2.0, IN SCOPE as a build
deliverable; separate repo PR).** Mirrors `src/widgets/common/FBT/` exactly:

- `src/widgets/common/LoyaltyClaim/` (`index.tsx`, `types.ts`, `variants.ts`,
  `V1/index.tsx`): `"use client"` wrapper that reads `?loyalty_qr=` from the URL
  (returns `null` when absent — zero cost, FBT's `sourceId` gating), lazy-loads
  the SDK once via a module-level `loadSdkOnce()` promise from
  **`NEXT_PUBLIC_LOYALTY_SDK_URL`**, then calls
  `window.RatioLoyalty.initClaim(null)` and keeps the returned cleanup. The widget
  targets its own page origin; no backend URL is passed from the browser.
- Listens for `loyalty:login:request` → calls the storefront's
  `window.handleCustomLogin(false)` (KwikPass modal), same bridge style as FBT's
  `cart:*` / `fbtAddToHandler` events.
- **BFF routes (server-side, this repo's identity boundary):**
  `src/app/api/loyalty/status/route.ts` proxies status; `src/app/api/loyalty/claim/route.ts`
  resolves the verified phone from the KwikPass token via the GoKwik
  customer-profile API (`gk-access-token` + `gk-merchant-id`), then signs
  `sig = HMAC_SHA256(`${merchantId}.${qr}.${phone}.${ts}`, LOYALTY_CLAIM_SECRET)`
  (hex) and `POST`s `{merchantId, phone, ts, sig}` to our backend
  `/loyalty/qr/{code}/claim`. `runtime = "nodejs"`; the phone is masked in logs.
- Registered in `src/editor-integration/widget-registry.ts`
  (`WIDGET_TYPES.LoyaltyClaim`, minimal settings schema) and added to the
  **layout-level/root template** so it is present on every page (the QR can land
  anywhere); renders nothing without the query param.
- Env additions to wellversed-2.0: `NEXT_PUBLIC_LOYALTY_SDK_URL` (loader src),
  `LOYALTY_API_BASE_URL` (our backend base, server-only), `LOYALTY_CLAIM_SECRET`
  (per-merchant signing secret, server-only), `LOYALTY_MERCHANT_ID` (loyalty
  merchant id used in the signature), `GK_MERCHANT_ID` (GoKwik profile header).

**v2 trust boundary.** The *storefront BFF* — never the browser, never our
backend — resolves the phone. Our backend accepts a phone only inside a valid
per-merchant HMAC signature (constant-time compare, ±5-min timestamp window);
`body.merchantId` must equal the QR's `merchantId`. Uniqueness is still
`(qr_code_id, phone)` — the same phone may claim different QRs, only the same QR
twice is blocked. The backend imports no KwikPass/GoKwik code (see the v2
amendment banner at the top and `docs/agent/changes/loyalty-qr-claim-v2/PLAN.md`).

### 2c. Export flow (S3 + email)

1. Admin sets filters → `GET /api/customers` preview shows match count.
2. `POST /api/exports {filters, email?}` — if count > 10,000 the admin UI
   requires an email (pre-filled from config `export_email`); server re-checks.
3. `exports.worker.ts` streams the mirror query to CSV (gzip), uploads via
   `S3Service.putObject(LOYALTY_EXPORT_S3_BUCKET, 'loyalty/exports/{merchantId}/{exportId}.csv.gz')`,
   stamps `row_count`/`s3_key`/`completed_at`.
4. If `email` set → `EmailService.send` with a 7-day presigned link; stamp `emailed_at`.
5. Admin history always offers `/download` (fresh 15-min presigned URL) —
   no CSV bytes stored in MySQL.

## 3. Data model / DB schema

Database **`loyalty_app`** (+ `loyalty_app_test`) — add block to
`docker/mysql/init/01-database.sql`. `db/types.ts` = core base tables
(`merchants`, `oauth_tokens`, `webhook_log`) + the **11** PRD tables.
`0001_initial.ts` creates all (standard three via `core/db/shared-migrations`).

| Table | PK | Indexes / constraints |
|---|---|---|
| `loyalty_configs` | `merchant_id` | `program_name`, `base_earn_rate`, `coin_value_inr`, `storefront_base_url`, `export_email` |
| `loyalty_customers` | (`merchant_id`,`phone`) | idx (`merchant_id`,`points_balance`), (`merchant_id`,`lifetime_spend`), (`merchant_id`,`last_order_at`), (`merchant_id`,`balance_synced_at`) |
| `loyalty_bulk_operations` | `id` char(26) | idx (`merchant_id`,`created_at`) |
| `loyalty_bulk_operation_rows` | `id` bigint auto | uq (`operation_id`,`row_number`); idx (`operation_id`,`status`) — resume = `WHERE status='pending'` |
| `loyalty_rules` | `id` char(26) | idx (`merchant_id`,`active`); `conditions` JSON condition tree |
| `loyalty_rule_customers` | (`rule_id`,`phone`) | — |
| `loyalty_rule_applications` | `id` bigint auto | uq (`rule_id`,`order_id`) — redelivery guard; idx (`merchant_id`,`applied_at`) |
| `loyalty_qr_codes` | `id` char(26) | uq `code` (16-char base32 from ULID); idx (`merchant_id`,`status`) |
| `loyalty_qr_scans` | `id` bigint auto | uq (`qr_code_id`,`phone`) — one scan/customer; idx (`merchant_id`,`scanned_at`); `converted_order_id`/`converted_at` nullable |
| `loyalty_exports` | `id` char(26) | idx (`merchant_id`,`created_at`); `s3_key`, `email` nullable, `emailed_at` nullable |
| `loyalty_daily_stats` | (`merchant_id`,`stat_date`) | issued/redeemed/expired/bulk-credited/bulk-debited/qr-points/rule-extra/customers-with-balance/outstanding |

Counter columns update atomically (`SET x = x + 1` in the same trx as the
guarded insert) — never read-modify-write.

## 4. Ratio integration

- **Scopes:** `read_orders`, `read_customers`.
- **Webhook topics** (slash-form per `docs/agent/context/learnings.md`; verify
  against a live delivery during build):
  - `app/uninstalled` → soft-delete merchant (template handler).
  - `orders/create` → in dispatch trx: (1) mirror upsert (phone E.164,
    name/email, spend +=, orders +=, last_order_at); (2) rule evaluation
    (Redis-cached set, condition trees, priority + stacking); extra > 0 → Core
    credit (`rule:{ruleId}:{orderId}`, metadata `{rule_id, order_id}`) + insert
    `loyalty_rule_applications`; (3) stamp QR conversion if the phone scanned
    within 30 days. Core calls 5s timeout (Ratio ~5s ack budget); failure →
    throw → webhook retry; idempotency keys make retries safe.
  - `orders/cancelled` → decrement mirror counters (floor 0). No coin clawback.
- **OAuth / install:** template flow — callback → token exchange +
  `LoyaltyBootstrap` seeds config in the install trx → install cookie → 302 to
  `RATIO_LOYALTY_ADMIN_BASE_URL`.
- **Core Loyalty auth:** merchant's stored OAuth access token as Bearer. Base =
  `LOYALTY_CORE_API_BASE_URL` (default `RATIO_API_BASE_URL`). 401 → one refresh → retry.
- **GoKwik identity:** `GET {RATIO_API_BASE_URL}/v1/storefront/customers/profile`,
  headers `gk-access-token` + `gk-merchant-id`; non-200 ⇒ `invalid_session`.

## 5. Config model

`packages/shared/src/schemas/loyalty-config.ts`:

```ts
loyaltyConfigInputSchema = z.object({
  programName: z.string().min(1).max(64).default('Coins'),
  baseEarnRate: z.coerce.number().positive().max(1000).default(1),   // coins per ₹1
  coinValueInr: z.coerce.number().positive().max(1000).default(0.1), // ₹ per coin
  storefrontBaseUrl: z.string().url(),                               // QR claim link base
  exportEmail: z.string().email().optional(),                        // default large-export recipient
});
```

`loyaltyRuleConditionSchema` (recursive condition tree) also lives in
`packages/shared` so the admin's visual rule builder and the backend validate
identically. The SDK imports shared types **type-only** (no Zod in browser).

## 6. Non-functional requirements

- **Env keys (derived by adding `loyalty` to `APPS`):**
  `RATIO_LOYALTY_DATABASE_URL`, `RATIO_LOYALTY_DATA_ENCRYPTION_KEY`,
  `RATIO_LOYALTY_CLIENT_ID`, `RATIO_LOYALTY_CLIENT_SECRET`,
  `RATIO_LOYALTY_CALLBACK_URL`, `RATIO_LOYALTY_ADMIN_BASE_URL`.
- **Env keys (module block in `env.schema.ts` baseEnv, like the WIZZY_ block):**
  `LOYALTY_WORKER_ENABLED` (`'true'|'false'`, default `'false'`),
  `LOYALTY_EXPORT_S3_BUCKET` (string), `LOYALTY_BULK_CONCURRENCY` (int, default 5),
  `LOYALTY_BULK_VISIBILITY` (seconds, default 300).
  **Both** the Core Loyalty client and the GoKwik customer-profile client
  (KwikPass token verification) derive their base from `RATIO_API_BASE_URL` —
  the loyalty endpoints and the GoKwik profile API live on the same OS-ecosystem
  host, so no per-client base-URL env exists.
- **Env keys (core, new):** `EMAIL_FROM` (SES sender; unset ⇒ email no-op),
  optional `S3_ENDPOINT` (local dev override, mirroring `SQS_ENDPOINT`).
- **CORS:** storefront origin(s) in `ALLOWED_ORIGINS` for `/loyalty/qr/*`;
  `/loyalty/sdk/*` is CORS `*` (public bundles + redacted config, wizzy pattern).
- **Queues:** `loyalty-bulk-ops` (`{opId, merchantId, rowIds}` ≤ 500 rows/msg),
  `loyalty-exports` (`{exportId, merchantId}`); consumed when `LOYALTY_WORKER_ENABLED=true`.
- **Bulk processing:** debit pre-checks balance; per-row `bulk:{opId}:{rowNo}`
  idempotency at `LOYALTY_BULK_CONCURRENCY`; crash resume = `WHERE status='pending'`.
- **Redis (core `RedisService`, degrade-to-DB):** rule cache
  `loyalty:rules:{merchantId}` (TTL 10 min + delete-on-mutation); CUSTOMER_LIST
  membership in the same value for lists ≤ 10k phones, else DB; claim/status
  rate-limit counters; snapshot lock. One-scan-per-phone stays DB-enforced
  (unique index) — correctness never depends on Redis.
- **Security:** HMAC webhook guard; OAuth tokens encrypted at rest; claim
  endpoint never accepts a client phone; public endpoints rate-limited, generic
  errors (no phone/session oracle); presigned URLs short-lived (download 15 min,
  email 7 days); logs mask phone to last-4; Core/GoKwik clients never log
  response bodies; `gkAccessToken` never logged.
- **SDK size budgets** (`size-limit`): loader ≤ 3 KB, claim widget ≤ 12 KB.
- **Pagination:** default 20, max 100.
- **Performance budgets:** webhook handler p95 < 1.5s; rule cache-hit path does
  zero MySQL rule queries; claim p95 < 1s (one GoKwik verify + one Core credit);
  bulk 50k rows < 3h at concurrency 5; export 100k rows < 5 min.
- **Analytics completeness (PRD §4.5 full scope):** coins-economy tiles + 30/7/90-day
  + custom-range trend (`loyalty_daily_stats`), per-rule performance, per-QR
  performance **including conversion-to-order**, bulk-ops summary. Snapshot
  granularity is daily (no Core event stream exists) — documented in the admin UI.

## 7. Deployment placement

- **API placement:** `shared` — **Worker placement:** `shared-api` (approved STATE.json).
- **Runtime:** same immutable backend image, `main.js`; `loyalty` in the shared
  API workload's `ENABLED_MODULES`; `LOYALTY_WORKER_ENABLED=true` on the shared
  API deployment (consumers idempotent; snapshot Redis-locked — mirrors
  `WIZZY_SYNC_WORKER_ENABLED`). Backend image must include the built
  `packages/loyalty-sdk/dist` (wizzy-sdk precedent) so `/loyalty/sdk/*` serves.
- **External delivery change (GitOps/pipeline repo owned by DevOps):** six
  `RATIO_LOYALTY_*` secrets + `LOYALTY_*` vars (+ core `EMAIL_FROM`); pod IAM →
  two SQS queues (+ DLQs), `s3:PutObject/GetObject` on
  `LOYALTY_EXPORT_S3_BUCKET/loyalty/exports/*`, `ses:SendEmail` from `EMAIL_FROM`;
  ALB routes `/loyalty/*` (incl. public `/loyalty/qr/*`, `/loyalty/sdk/*`);
  storefront origin in `ALLOWED_ORIGINS`; publish `apps/admin-loyalty` via the
  standard admin static pipeline.
- **Storefront deliverable (in scope, separate repo PR):** the
  `LoyaltyClaim` Shopkit widget wrapper in wellversed-2.0 (§2b Part 2 —
  FBT-style: widget + registry entry + root-template placement + two
  `NEXT_PUBLIC_LOYALTY_*` env vars), built after this repo's app is deployed;
  non-Shopkit merchants can instead use the self-init loader `<script>` snippet
  shown in the QR admin screen.
- **Scaling rationale:** low-QPS admin + event-day claim bursts; queue work is
  Core-API-latency-bound — shared pods suffice.

## 8. Open questions / risks

1. **Merchant JWT acceptance** — design assumes the app's merchant OAuth token
   satisfies the loyalty endpoints' `bearer` scheme. Fallback:
   `POST /api/v1/auth/merchant/token`. Verify with one UAT call early in
   backend-builder; auth isolated in `core-loyalty.client.ts`.
2. **Core phone-key format** — `+91…` vs 10-digit unknown; wrong guess ⇒ split
   balances. Verify against UAT early; normalization in one `normalizePhone()`.
3. **S3 bucket + SES identity provisioning** — `LOYALTY_EXPORT_S3_BUCKET` and a
   verified SES sender (`EMAIL_FROM`) must exist per environment (DevOps).
   Local dev: email no-ops, S3 via `S3_ENDPOINT` override or skipped.
4. **Does Core credit base earn on `orders/create` in UAT today?** App credits
   only rule extras; base earning is Core's dependency. Confirm before launch.
5. **GoKwik profile `gk-merchant-id` mapping** — base URL resolved
   (= `RATIO_API_BASE_URL`; the GoKwik profile API shares the OS-ecosystem
   host). Still confirm that the `gk-merchant-id` header equals the Ratio
   merchant id in UAT/prod.
6. **KwikPass token key stability** — the widget reads the token from KwikPass
   storage keys (`KWIKUSERTOKEN` variants); a KwikPass SDK change could rename
   them. Mitigation: key list centralized in one SDK module; claim fails soft to
   the login CTA.
7. **Core rate limits unknown** — bulk concurrency env-tunable; client retries
   429 with backoff.
