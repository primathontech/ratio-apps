# TRD — CleverTap (`clevertap`)

> Technical Requirements / Design Document. Produced by `trd-architect` from the
> approved PRD, then human-approved at **GATE 2** before the test plan is written.

**Source PRD:** `docs/agent/apps/clevertap/PRD.md`
**Gaps / platform asks:** `docs/agent/apps/clevertap/TODO.md`
**Status:** draft — awaiting GATE 2

Design principle throughout: this app is **structurally the MoEngage app plus a
secret and an outbound API client**. Where a decision is already made in
`modules/moengage`, follow it rather than inventing; where a secret is involved,
follow `modules/wizzy` (write-only secret semantics). Deviations from those two
are called out explicitly.

---

## 1. Module shape

Scaffolded from `apps/backend/src/modules/_template/` (never hand-rolled). Files
under `apps/backend/src/modules/clevertap/`:

| File | Role |
|---|---|
| `clevertap.module.ts` | `@Module` — imports `ClevertapKyselyModule`; declares controllers, services, bootstrap, handlers, guards; spreads `createAppProviders<ClevertapDatabase>({slug:'clevertap', dbToken: CLEVERTAP_DB_TOKEN, bootstrapClass, handlerClass}, {CRYPTO, RATIO, MERCHANTS, OAUTH, WEBHOOKS})`. `exports: []` — nothing crosses modules. |
| `tokens.ts` | `CLEVERTAP_CRYPTO`, `CLEVERTAP_RATIO`, `CLEVERTAP_MERCHANTS`, `CLEVERTAP_OAUTH`, `CLEVERTAP_WEBHOOKS`. Separate file to break the circular import with `guards.ts` (same reason as moengage). |
| `kysely.module.ts` | `CLEVERTAP_DB_TOKEN` + per-module Kysely client over the `clevertap_app` database. |
| `guards.ts` | `ClevertapMerchantTokenGuard`, `ClevertapWebhookSignatureGuard`. |
| `clevertap.bootstrap.ts` | `AppBootstrap<ClevertapDatabase>` — seeds the config row inside the OAuth install transaction. |
| `config/config.controller.ts` · `config.service.ts` · `clevertap-config.dto.ts` | Config read/write. **Service injects `CLEVERTAP_CRYPTO`** (moengage does not — the passcode is a secret). |
| `sdk/sdk.controller.ts` · `sdk.service.ts` | Serves the per-merchant pixel JS. |
| `events/clevertap-events.client.ts` | **New vs moengage.** Outbound client for CleverTap's server-side Events API. Class with an injectable `fetchImpl` for testability, mirroring `modules/loyalty/core-client/core-loyalty.client.ts`. |
| `events/order-event.mapper.ts` | Pure functions: Ratio order payload → CleverTap event bodies. Pure so the TDD can unit-test paise→rupees and line-item mapping with no I/O. |
| `webhooks/topics.ts` | The 9 `event_type` string constants, centralised (pattern from `loyalty`/`wizzy`/`google`). |
| `webhooks/app-uninstalled.handler.ts` | Soft-delete the merchant. |
| `webhooks/order-paid.handler.ts` · `order-created.handler.ts` · `order-cancelled.handler.ts` · `order-fulfilled.handler.ts` · `order-partially-fulfilled.handler.ts` · `order-updated.handler.ts` | Order topics → forward. |
| `webhooks/customer-created.handler.ts` · `customer-updated.handler.ts` | Customer topics → profile upsert. Inert until **both** the UAT sync lands **and** `envelopeResource` gains a `customer` branch (TODO.md §1a, §8 R7 + R9). |
| `webhooks/webhooks.controller.ts` | Signature-guarded inbound endpoint. |
| `merchants/merchants.controller.ts` | Merchant status for the admin. |
| `oauth/oauth.controller.ts` | OAuth callback. |
| `db/types.ts` · `db/migrations/0001_initial.ts` | Kysely types + schema. |

Storefront pixel source lives at `apps/backend/pixel/clevertap-pixel.ts` (compiled
to `apps/backend/static/clevertap-pixel.js` by
`pnpm --filter @ratio-app/backend pixel:build:all`), alongside the four existing
pixels.

**Handler granularity.** Six order handlers rather than one switch: the core
dispatcher matches on `topic`, and one class per topic is the established pattern
(`google`, `wizzy`, `loyalty`). All six delegate to one shared
`ClevertapForwardingService` so the mapping/idempotency/skip logic exists once.

---

## 2. API routes

| Method | Path | Auth guard | Request | Response | Purpose |
|---|---|---|---|---|---|
| `GET` | `/clevertap/api/defaults` | none | — | `{eventMap, events, regions}` | Seed values for the admin. Mirrors `moengage/api/defaults`. |
| `GET` | `/clevertap/api/clevertap-config` | `ClevertapMerchantTokenGuard` | — | `ClevertapConfigOutput` — **redacted**: `passcodeSet: boolean`, never the passcode | Load the config form. |
| `PUT` | `/clevertap/api/clevertap-config` | `ClevertapMerchantTokenGuard` | `ClevertapConfigInput` | `ClevertapConfigOutput` (redacted) | Save config. Write-only passcode semantics (§5). |
| `GET` | `/clevertap/api/status` | `ClevertapMerchantTokenGuard` | — | `{configComplete, serverEventsEnabled, lastEventAt, lastEventTopic, lastError, forwardedCount24h}` | Powers the install/status screen. **New vs moengage** — the PRD asks for a readiness summary. |
| `GET` | `/clevertap/api/merchants/me` | `ClevertapMerchantTokenGuard` | — | `Merchant` | `isActive` check; admin routes inactive merchants to `/disabled`. |
| `GET` | `/clevertap/sdk/:merchantId.js` | none (public, `ACAO: *`) | `:merchantId` via `MerchantIdPipe` | `application/javascript` | The pixel. 404 `MERCHANT_INACTIVE` / `CONFIG_INCOMPLETE`, 503 `PIXEL_MISSING`. |
| `POST` | `/clevertap/api/v1/oauth/webhook` | `ClevertapWebhookSignatureGuard` | Ratio envelope | `2xx` | Inbound webhook dispatch. **Corrected during implementation** — an earlier draft of this table said `/clevertap/webhooks`. The scaffolded route is `clevertap/api/v1/oauth/webhook`, identical in shape to all five live vendors (`@Controller('clevertap/api/v1/oauth')` + `@Post('webhook')`), and the platform subscription URL must use it. |
| `GET` | `/clevertap/oauth/callback` | none (state-validated) | `?code&state` | redirect to admin | OAuth install. |

`Cache-Control: public, max-age=300` is set **inside `sdk.service.render()` on the
success path only** — never as a route-level `@Header()`, which would cache
404/503 and poison CDNs during installation races (carried directly from the
moengage finding).

---

## 3. Data model / DB schema

Database `clevertap_app` (CREATE + GRANT added to
`docker/mysql/init/01-database.sql`). `db/migrations/0001_initial.ts` creates the
three standard tables (`merchants`, `oauth_tokens`, `webhook_log`) and then:

**Migration history is folded, not copied verbatim** (as-built; an earlier draft of
this section said the tables were copied verbatim from `_template`). `_template`
ships three migrations; the scaffolded `0002_drop_unused_indexes.ts` and
`0003_tighten_config_columns.ts` were **deleted** and their end state folded into
`0001_initial.ts`. Rationale: this database is brand new, so there is no history to
preserve — `0003` narrowed `api_key`/`host` columns that do not exist in the
CleverTap config table at all, and `0002` dropped an index that `0001` had just
created. Consequences, both pinned by `test/unit/apps/clevertap/migration.test.ts`:

- `idx_webhook_log_unprocessed` is **never created** (other vendors create it in
  `0001` and drop it in `0002`; see `core/db/shared-migrations.ts`).
- Every column is created at its **final width** — no later `ALTER`.

Net end state is identical to what the other vendors reach after their full
migration history. Do not "restore" 0002/0003: that would re-create and re-drop the
index and fail the test that asserts its absence.

**`clevertap_configs`**

| Column | Type | Notes |
|---|---|---|
| `merchant_id` | `varchar(128)` PK | FK → `merchants.id` `ON DELETE CASCADE` |
| `account_id` | `varchar(64)` NOT NULL | CleverTap Account ID. Default `''`. Not secret — ships to the browser. |
| `passcode_enc` | `text` NULL | **Encrypted at rest** via `CryptoService`. `_enc` suffix per the wizzy convention. |
| `region` | `varchar(8)` NOT NULL | Default `'in1'`. |
| `server_events_enabled` | `boolean` NOT NULL | Default `false`. |
| `debug` | `boolean` NOT NULL | Default `false`. |
| `events` | `json` NOT NULL | `eventMapSchema`; seeded by `buildDefaultEventMap('clevertap')`. |
| `created_at` / `updated_at` | `datetime(3)` | `CURRENT_TIMESTAMP(3)` / `ON UPDATE`. |

**`clevertap_forwarded_events`** — outbound idempotency + delivery health.

| Column | Type | Notes |
|---|---|---|
| `id` | `char(36)` PK | `DEFAULT (UUID())` |
| `merchant_id` | `varchar(128)` NOT NULL | FK → `merchants.id` `ON DELETE CASCADE` |
| `idempotency_key` | `varchar(255)` NOT NULL | `<event_type>:<order_or_customer_id>` |
| `topic` | `varchar(128)` NOT NULL | |
| `clevertap_event` | `varchar(64)` NOT NULL | e.g. `Charged` |
| `status` | `varchar(16)` NOT NULL | `sent` \| `failed` \| `skipped` |
| `error` | `text` NULL | Last error, for the status screen. |
| `sent_at` | `datetime(3)` NOT NULL | `DEFAULT CURRENT_TIMESTAMP(3)` |

- `UNIQUE (merchant_id, idempotency_key)` — the outbound idempotency guarantee.
- `INDEX (merchant_id, sent_at)` — the status screen's recent-activity query.

**Why a second table.** Core dedupes *inbound* on `webhook_log.ratio_webhook_id`,
but that window is retry-scoped (~3h on `received_at`) and, more importantly, a
delivery can be logged and then fail mid-forward — a redelivery would re-send
`Charged` and double-count revenue. A unique outbound key makes the forward
idempotent independently, and the same rows drive `GET /api/status`. Insert the
row **before** the outbound call and update `status` after, so a crash between
the two leaves a `failed` row rather than a silent gap.

---

## 4. Ratio integration

**Scopes:** `read_orders`, `read_customers`.

**Webhook topics + handlers** (`webhooks/topics.ts` — exact `event_type` strings;
a mismatch makes the dispatcher silently skip, so these are verified against the
live registry and re-verified against a real delivery per §8 R-items):

| Topic | Handler | CleverTap event | Behaviour |
|---|---|---|---|
| `app/uninstalled` | `app-uninstalled.handler` | — | Soft-delete: `is_active=false`, `uninstalled_at=now()`. Preserve `clevertap_configs`. `SELECT … FOR UPDATE` on the merchant row to serialise against a concurrent OAuth reinstall; no-op if already inactive (retry-safe). All writes via `trx`. |
| `orders/paid` | `order-paid.handler` | **`Charged`** | Primary purchase event. Full line items, paise→rupees. |
| `orders/create` | `order-created.handler` | `Order Created` | **Must not emit `Charged`** — prevents double-counting when both topics fire. |
| `orders/cancelled` | `order-cancelled.handler` | `Order Cancelled` | |
| `orders/fulfilled` | `order-fulfilled.handler` | `Order Fulfilled` | |
| `orders/partially_fulfilled` | `order-partially-fulfilled.handler` | `Order Partially Fulfilled` | |
| `orders/updated` | `order-updated.handler` | `Order Updated` | Forwards **once per order only** — the idempotency key carries no version component (§8 R11). |
| `customers/create` | `customer-created.handler` | profile upsert | Inert — needs the UAT sync **and** R9. |
| `customers/update` | `customer-updated.handler` | profile upsert incl. consent flags | Inert — needs the UAT sync **and** R9. |

Inbound signature: `x-openstore-signature: sha256=<hex>` per the platform docs, but
the core guard actually reads `x-ratio-hmac-sha256` — unresolved drift, see §8 R10.
Verified by `ClevertapWebhookSignatureGuard` (core). Envelope is
`{ event_type, merchant_id, … }` with **no top-level delivery id or timestamp** —
hence the derived idempotency key.

**Subscription registration.** Topics are registered with the platform via
`POST /api/v1/app-webhooks` (`{eventName, webhookUrl, secretKey?, customHeaders?}`)
or the admin `webhook-setup/sync` path — which mechanism this app uses, and with
what auth, is **R3** in §8. This is configuration, not module code.

**OAuth / install.** Merchant-initiated, standard core flow. `ClevertapBootstrap.run(trx, merchantId)` executes inside the install transaction and seeds `clevertap_configs` with
`INSERT … ON DUPLICATE KEY UPDATE merchant_id = merchant_id` — a deliberate
self-update no-op so **reinstall preserves the merchant's Account ID and
passcode**. Not `.ignore()`, which would swallow genuine errors (truncation, FK,
NOT NULL). `events` is `JSON.stringify`'d before insert — mysql2 does not
auto-encode objects into JSON columns.

---

## 5. Config model

`packages/shared/src/schemas/clevertap-config.ts`:

```
clevertapAccountIdSchema  = string, trim, 1..64, /^[A-Z0-9-]+$/   (R4: confirm charset)
clevertapPasscodeSchema   = string, trim, 1..128
clevertapRegionSchema     = z.enum(Object.keys(CLEVERTAP_REGIONS))
clevertapConfigSchema     = { accountId, region, debug=false, serverEventsEnabled=false, events }
clevertapConfigInputSchema = clevertapConfigSchema.partial({events, debug, serverEventsEnabled})
                              .extend({ passcode: clevertapPasscodeSchema.or(z.literal('')).optional() })
clevertapConfigOutputSchema = clevertapConfigSchema.extend({ passcodeSet: z.boolean() })
```

`packages/shared/src/constants/clevertap-events.ts`:

- `DEFAULT_CLEVERTAP_EVENT_MAP` — `satisfies Record<OpenStoreEventName, string>`, so adding an OpenStore event forces a CleverTap mapping. Uses CleverTap's own reserved names where they exist (`Charged`) and Title Case otherwise: `PageView→Page Browse`, `ViewContent→Product Viewed`, `AddToCart→Added to Cart`, `InitiateCheckout→Checkout Initiated`, `Purchase→Charged`, plus `Search`, `Add to Wishlist`, `Lead`, `Registration Completed`, `Contact`, `Subscribe`, `Shipping Info Submitted`, `Payment Info Submitted`.
- `CLEVERTAP_REGIONS` — `{ in1, eu1, sg1, us1, aps3, mec1 }`, each `{label, apiHost, dashboard}`. `apiHost` = `https://<region>.api.clevertap.com` (R4).

Barrel exports added to `packages/shared/src/index.ts` under their real names
(`DEFAULT_CLEVERTAP_EVENT_MAP`, `CLEVERTAP_REGIONS`) — never a generic alias.

**Write-only passcode semantics** (wizzy pattern, `config.service.ts`):

| `passcode` in PUT body | Action |
|---|---|
| absent / `undefined` | leave `passcode_enc` untouched |
| `''` | clear → `passcode_enc = NULL` |
| non-empty | `crypto.encrypt(value)` → store |

`GET` and `PUT` both return the **redacted** shape (`passcodeSet: boolean`). The
passcode is never returned by any endpoint, never in the pixel prelude, and never
logged.

---

## 6. Non-functional requirements

**Env keys** — `config/env.schema.ts` derives **exactly six** keys per slug in
`APPS` via a `.reduce`; never edit that file. Only `.env.example` gets the
`RATIO_CLEVERTAP_*` block: `DATABASE_URL`, `DATA_ENCRYPTION_KEY` (44-char base64,
validated), `CLIENT_ID`, `CLIENT_SECRET`, `CALLBACK_URL`, `ADMIN_BASE_URL`.

There is **no** `WEBHOOK_SECRET` key — an earlier draft of this TRD wrongly listed
one. Ratio signs webhooks with `HMAC-SHA256(rawBody, <app client_secret>)`, so the
signature guard reads `RATIO_CLEVERTAP_CLIENT_SECRET`
(`core/webhooks/webhook-signature.guard.ts`, and `modules/moengage/guards.ts` for
the per-module wrapper pattern).

**Security**
- HMAC verification on every inbound webhook: header `x-openstore-signature: sha256=<hex>` per the docs — the guard reads `x-ratio-hmac-sha256` (§8 R10) — secret `RATIO_CLEVERTAP_CLIENT_SECRET`, via `createWebhookSignatureGuard`.
- `passcode_enc` and both OAuth tokens encrypted at rest.
- The pixel prelude contains `accountId`, `region`, `debug`, `merchantId`,
  `eventNameMap` — and **never** the passcode. Enforced by a test asserting the
  rendered JS does not contain the plaintext.
- Prelude JSON emitted via `core/common/safe-inline-json` (XSS-safe `<`/`</script>` escaping).
- `:merchantId` validated by `MerchantIdPipe` (`^[A-Za-z0-9_-]{1,128}$`) before any DB lookup.
- Log redaction: never log the passcode, shopper phone, or email. Log `merchantId`, topic, idempotency key, status.

**Correctness invariants**
- **Money:** ⚠️ **SUPERSEDED 2026-07-29 — do NOT divide order amounts by 100.** The official webhook docs (https://sandbox-developers.dev.gokwik.in/docs/webhooks/topics) put ORDER money in **rupees** as decimal strings (`total_price: "1200.00"`); only `products/*` is integer paise. Dividing under-reports CleverTap revenue 100× (a ₹1,200 order arrived as ₹12). The mapper now parses without scaling (`parseRupees`), pinned by a named regression test. See `CONTEXT.md` standing context.
- **Phone:** normalise to `+91XXXXXXXXXX` — CleverTap's `Identity` and the primary key for India.
- **`Charged` only from `orders/paid`.**

**Limits / performance**
- Pixel: cached in-process after first read; 5-minute `Cache-Control`; MoEngage-equivalent async load. Budget: `< 50ms` added TTI (PRD watch-out).
- Outbound forwarding: inline in the handler (no worker — `workerPlacement: none`). 10s timeout, bounded retry, and **failures must not fail the webhook** — the row is marked `failed` and the handler returns 2xx, so the platform does not redeliver forever for a CleverTap-side outage.
- Forwarding is skipped entirely (no outbound call, no error) when `server_events_enabled` is false or `passcode_enc` is NULL.

**Storefront pixel design** (`apps/backend/pixel/clevertap-pixel.ts`)

1. Read `window.__CLEVERTAP_RATIO_CONFIG__`; silently no-op if absent/incomplete.
2. Load the CleverTap Web SDK asynchronously from the single `CLEVERTAP_SDK_URL` constant (`https://d2r1yp2w7bby2u.cloudfront.net/js/clevertap.min.js`); publish the region **both** documented ways — `clevertap.account.push({id: accountId}, region)` **and** `clevertap.region = region` — since the vendor documents each and both are idempotent (**R5 resolved**; `eu1` caveat in R12).
3. Register with `window.__OPEN_STORE_PIXEL_RUNTIME__`, or queue into `window.__OPEN_STORE_PIXEL_PENDING__` if the runtime has not loaded yet.
4. Subscribe to each OpenStore event present in `eventNameMap`; map properties; `clevertap.event.push(mappedName, attrs)`.
5. **Identity bridge** — before each event, derive identity from `metadata.user_data`. On a new identity: `clevertap.onUserLogin.push({Site: {Identity, Phone, Email, Name}})`. Dedupe on an identity signature so an unchanged identity does not re-fire. On identity change (A→B) re-identify; on logout, clear local identity state. This is the PRD's KwikPass advantage, obtained without a KwikPass code change (D4).
6. Wrap every handler in try/catch — a CleverTap failure must never break the storefront.

---

## 7. Deployment placement

- **API placement:** `shared` — append `clevertap` to the common API Deployment's `ENABLED_MODULES`.
- **Worker placement:** `shared-api` — the opt-in CleverTap forwarding consumer (`CLEVERTAP_FORWARD_WORKER_ENABLED`, default off) runs in the shared API pods; forwarding is inline when the flag is off.
- **Runtime command / flags:** `main.js`, no worker flag. Same immutable image.
- **Routing / probes:** existing shared-API ALB rules already cover `/<slug>/*`; no new rules. Public paths `/clevertap/sdk/*` rely on the existing global CORS/`ACAO: *` handling.
- **Secrets:** the six `RATIO_CLEVERTAP_*` values into the shared API's secret store. No new IAM, no queues, no S3.
- **Scaling signals:** one cached pixel GET per storefront page + a handful of webhook POSTs per order. When `CLEVERTAP_FORWARD_WORKER_ENABLED` is off the profile matches MoEngage/PostHog (inline forwarding); enabling it adds the Kafka forwarding consumer in the shared-API pods (`shared-api`) for retry/DLQ isolation of outbound delivery.
- **External delivery change:** add `clevertap` to `ENABLED_MODULES` and add the secret block in the **external EKS GitOps/pipeline configuration**. **Do not create Kubernetes manifests in this repo.**

---

## 8. Open questions / risks

| # | Item | Impact if wrong | Resolution |
|---|---|---|---|
| **R1** | Confirm each of the 9 `event_type` strings against a **real delivery**, not just the registry listing. | A mismatch makes the core dispatcher **silently skip** the handler — no error, no events. Worst failure mode here. | Capture one real delivery per topic in UAT. Only `products/*` has been confirmed live so far. |
| **R2** | Real `orders/paid` payload shape: field names, customer snapshot location, and whether line-item prices are integer **paise**. | Wrong money units inflate CleverTap revenue 100×; wrong field paths yield empty `Charged` events. | **RESOLVED 2026-07-29** from the official webhook docs (https://sandbox-developers.dev.gokwik.in/docs/webhooks/topics). Both assumptions were WRONG and both were fatal: (1) order money is **rupees** as decimal strings, not paise — the divide under-reported revenue 100×; (2) there is no guaranteed customer snapshot — `customer`/`customer_id` are **null** in the docs' own sample, with `email`/`phone` at the order top level, so identity-from-`order.customer` emitted an identity-less record that CleverTap rejects with **error 523**. Also settled: all **8** order topics deliver the identical order object, `line_items` is always present, and timestamps are ISO-8601 **UTC `Z`** (not `+05:30`). The docs' sample is now the canonical fixture. |
| **R3** | How this app registers subscriptions — `POST /api/v1/app-webhooks` vs admin `webhook-setup/sync` — and which auth it presents. | Zero webhooks delivered. | Confirm with the platform team; it is config, not code. |
| **R4** | CleverTap Account ID charset, and the exact `<region>.api.clevertap.com` host list + Events API contract (`POST /1/upload`, `X-CleverTap-Account-Id` / `X-CleverTap-Passcode`, `Charged` event body shape). | Over-strict Zod rejects valid IDs; wrong host/headers means every forward 4xxs. | **RESOLVED 2026-07-26** against developer.clevertap.com + live host probes. Confirmed correct: the `/1/upload` path, both header names, the `{d:[...]}` envelope, event/profile record shapes, `identity`-as-phone, the `+91` normalisation, the Account ID regex, and treating a 200-`partial` as failure. **Corrections applied:** `aps3` was mislabelled 'Mumbai' (it is **Indonesia**; India is `in1`); `Items` is now capped at CleverTap's documented **256** limit; CleverTap's `code`/`error` diagnostics are surfaced (never `unprocessed[].record`, which echoes PII); `readBatchStatus` now **fails closed**; the unverified '`Charged ID` dedupes vendor-side' claim was removed; `profileData.Identity` dropped; reserved `Payment mode` added; and a nesting guard added because `Items` is the **only** field any CleverTap event may nest (anything else = error 512, silently killing the event). Note the merchant-facing naming trap: CleverTap's dashboard calls the Account ID **'Project ID'**, and the separate **'Project Token'** must not be used. |
| **R5** | Exact CleverTap Web SDK CDN URL and the current region-init form. | Pixel silently fails to load. | **RESOLVED** — CDN is `https://d2r1yp2w7bby2u.cloudfront.net/js/clevertap.min.js`, isolated in the single `CLEVERTAP_SDK_URL` constant in the pixel and asserted in its test. Region is published **both** documented ways (`clevertap.account.push({id}, region)` and `clevertap.region = region`); both are idempotent, both asserted. Follow-up on `eu1`: R12. |
| **R6** | `app/uninstalled` is **not** in the 21-event catalog, yet every module here handles it. | If it is registered differently, uninstall leaves the merchant active and the pixel serving. | Confirm it is an app-lifecycle webhook registered separately from the merchant-data registry. |
| **R7** | `customers/*` unsynced in UAT (18 of 21). | Handlers built but inert; **marketing-consent changes do not propagate**, so an opted-out customer can keep receiving CleverTap messages. | `POST admin/webhook-setup/sync` — ops action, tracked as task #2. Non-blocking. |
| **R8** | No `checkouts/*` topic exists at all. | **No server-side checkout abandonment** — the source PRD's headline use case. Degrades to the browser-dependent pixel `InitiateCheckout`. | Platform ask, tracked as task #1. Accepted for v1; pre-cut a v1.1 handler slot. |
| **R9** | `customers/*` has a **second** blocker beyond the registry sync (R7): `core/webhooks/webhooks.types.ts#envelopeResource` returns `(e.product ?? e.order ?? {})` — there is **no `customer` branch**, so a customer delivery reaches `handle()` as `{}`. | Even after the sync lands, both customer handlers receive an empty resource. They degrade to warn + no-op (tested), so nothing breaks — but nothing propagates either, including marketing consent. | Add a `customer` branch to `envelopeResource`. This is a `core/` change and therefore **feature-tier work**, deliberately *not* made from inside this module. `customers/*` needs **BOTH** the platform sync (R7) **and** this core change before it can ever work. |
| **R10** | **Signature header drift — affects every vendor, pre-existing, not introduced by this build.** The PRD/TRD and `docs/agent/context/learnings.md` (2026-06-18) say the platform sends `x-openstore-signature`; `core/webhooks/webhook-signature.guard.ts` reads `x-ratio-hmac-sha256`. | If the platform really sends `x-openstore-signature`, the guard sees **no header**. That is tolerated only when `NODE_ENV !== 'production'` **OR** `WEBHOOK_SIGNATURE_OPTIONAL=true`. In production with neither, **every delivery 401s**; with the flag set, every delivery is silently **unverified**. | **Must be settled against a real delivery before go-live** — inspect the actual request headers, then fix whichever side is wrong. Not fixable from inside this module. |
| **R11** | `orders/updated` forwards only **once** per order: the idempotency key is `<event_type>:<order_id>` with **no version component**, so the 2nd and later updates hit the duplicate guard and are skipped. | An order updated three times sends one `Order Updated` event; later edits never reach CleverTap. | Implemented **as specified** (§3). Widening the key (e.g. adding `updated_at` or a revision) is a **spec change**, not a bug fix — raise it before changing behaviour. |
| **R12** | **R5 follow-up.** Whether `eu1` is a valid region — CleverTap's Web SDK README lists only `in1, us1, sg1, aps3, mec1`. | An `eu1` merchant could get a browser-side region fallback with no error surfaced. | **RESOLVED 2026-07-26 — `eu1` IS valid; keep it.** CleverTap's own Node SDK defines `EUROPE: 'eu1'` and **defaults to it** when no region is supplied, and a live probe shows `eu1.api.clevertap.com` is a distinct, working CleverTap host. Web-SDK side, the shipped bundle has no region allowlist — it templates the string into the host and its no-region default is literally `eu1.clevertap-prod.com`, so passing `eu1` is a no-op equivalent of omitting it. The README omission was a red herring. Our six-region list is complete; only the **labels** were wrong (see R4). |
| **R13** | Backend `tsconfig.json` **excludes `test/`**, so test files are typechecked by **no command in this repo** — they are only executed. | A type error in a test surfaces as a **runtime failure**, not a typecheck failure — so `pnpm typecheck` passing says nothing about the test suite compiling. | Awareness item: read test failures as possible type errors. Adding a test-scoped tsconfig is a repo-wide change, out of scope for this module. |

**Accepted for v1 without resolution:** R7, R8, R11, R13 (tracked, non-blocking).
**Must resolve before the corresponding code is written:** R1/R2 before the order
mapper, R4/R5 before the client and pixel, R3/R6 before QA.
**Must resolve before go-live:** R10 (production either 401s every delivery or runs
unverified). **Blocks `customers/*` shipping at all:** R7 **and** R9 together.
