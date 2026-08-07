# TDD — CleverTap (`clevertap`)

> Test Plan / Test-Driven Design. Produced by `tdd-author` from the approved TRD,
> then human-approved at **GATE 3** before any scaffolding. The builders write
> these tests first (failing), then implement to green.

**Source PRD/TRD:** `docs/agent/apps/clevertap/PRD.md`, `TRD.md`
**Gaps:** `TODO.md`
**Status:** draft — awaiting GATE 3

---

## 1. Test strategy

**Runner:** Vitest. Backend unit tests in `apps/backend/test/unit/apps/clevertap/`;
admin tests colocated in `apps/admin-clevertap/src/**` (happy-dom); shared-schema
tests in `packages/shared/`.

**Unit-tested with fakes — no I/O, no live DB, no network:**

| Dependency | How it's faked |
|---|---|
| Kysely DB | In-memory fake, `helpers/fake-clevertap-db.ts`, following `test/unit/apps/loyalty/helpers/fake-loyalty-db.ts`. |
| CleverTap Events API | Injected `fetchImpl` on `ClevertapEventsClient` — the constructor already accepts it (mirrors `core-loyalty.client.ts`). Assert on the captured request; never hit the network. |
| `CryptoService` | Real instance with a fixed test key — encryption is cheap and we want to prove round-trip + that ciphertext ≠ plaintext. |
| Ratio platform / webhook delivery | Hand-built envelopes as fixtures. |
| CleverTap Web SDK | `window.clevertap` stub array-with-`push`, per `meta-pixel.test.ts` / `google-pixel.test.ts`. |
| OpenStore pixel runtime | Fake `__OPEN_STORE_PIXEL_RUNTIME__` with a controllable `register`, plus the not-yet-loaded case via `__OPEN_STORE_PIXEL_PENDING__`. |

**Integration-ish (still Vitest, still no external network):** the webhook
handler → forwarding-service → fake-fetch path, exercised end-to-end through the
real mapper so payload→outbound-body is proven in one go.

**Explicitly out of scope** (consistent with this boilerplate): heavy e2e/QA, a
live MySQL migration run, real CleverTap account calls, real browser testing.
Migration correctness is asserted structurally (§3.7), not by running MySQL.

**Blocked-on-R-items.** ⚠️ `R2` is **RESOLVED 2026-07-29** from the official
webhook docs (https://sandbox-developers.dev.gokwik.in/docs/webhooks/topics) —
and it resolved *against* two of this plan's assumptions: order money is
**rupees**, not paise, and there is no guaranteed `customer` snapshot (identity
comes from the order's top-level `phone`/`email`). `R1` (real `event_type`
strings) remains open. The plan handles this by putting
**every** payload assumption behind a single fixture file and a single mapper, so
when a real delivery is captured only `fixtures/order-payloads.ts` and possibly
`order-event.mapper.ts` change — no test names, no structure. Any fixture field
still unverified carries a `// R2:` comment.

---

## 2. Acceptance criteria → test mapping

| # | PRD acceptance criterion | Test case(s) |
|---|---|---|
| A1 | `clevertap` in `APPS`, registered in `module-registry.ts`, `RATIO_CLEVERTAP_*` in `.env.example`, MySQL CREATE+GRANT | `module-registry.test.ts` (existing, extended): "registers every APPS slug"; `wiring.test.ts`: "APPS contains clevertap", "env.schema derives RATIO_CLEVERTAP_* keys", "01-database.sql grants clevertap_app" |
| A2 | Install seeds the config row; **reinstall does not clobber** credentials | `bootstrap.test.ts`: "seeds a default config row on first install", "second install is a no-op and preserves accountId + passcode_enc", "encodes events as a JSON string (mysql2 does not auto-encode)" |
| A3 | Config saves; `passcode` **encrypted at rest**, **never returned**, **never in prelude** | `config.service.test.ts`: "encrypts passcode on write", "stored passcode_enc is not the plaintext", "round-trips via decrypt", "GET output omits passcode and exposes passcodeSet"; `sdk.service.test.ts`: "prelude never contains the passcode plaintext" |
| A4 | Pixel route: JS+prelude for active+configured; 404 `MERCHANT_INACTIVE`; 404 `CONFIG_INCOMPLETE`; `Cache-Control` on success only | `sdk.service.test.ts`: "renders prelude + pixel body for a configured merchant", "404 MERCHANT_INACTIVE when merchant missing/inactive", "404 CONFIG_INCOMPLETE when accountId empty", "404 CONFIG_INVALID_REGION for an unknown region", "sets Cache-Control only on success", "does NOT set Cache-Control on any error path", "503 PIXEL_MISSING when the asset is absent", "checks merchant before config (inactive must win)" |
| A5 | Pixel loads the SDK for the region, registers with the runtime (queues if absent), forwards each enabled event under its mapped name | `clevertap-pixel.test.ts`: "no-ops silently when config is missing/incomplete", "initialises the SDK with accountId + region", "registers with the runtime when present", "queues into __OPEN_STORE_PIXEL_PENDING__ when the runtime is absent", "forwards a subscribed event under its mapped CleverTap name", "ignores events absent from the event map", "a handler throw does not break the storefront" |
| A6 | Identity bridge: `onUserLogin` once per identity, phone `+91…`, switch re-identifies, logout clears, no duplicate for unchanged identity | `clevertap-pixel.test.ts` (identity block): "fires onUserLogin on first identified event", "normalises phone to +91XXXXXXXXXX", "does NOT re-fire for an unchanged identity", "re-identifies on identity change A→B", "clears identity state on logout", "never fires onUserLogin for a purely anonymous event" |
| A7 | `orders/paid` → `Charged` with line items, money in **rupees, unscaled** (was "paise→rupees" — reversed 2026-07-29) | `order-event.mapper.test.ts`: "maps orders/paid to Charged", and the named regression block **"REGRESSION: order money is RUPEES — a ₹1200 order is Amount 1200, never 12"** ("maps total_price \"1200.00\" to Amount 1200 (NOT 12)", "maps line-item price \"600.00\" to Price 600 (NOT 6)", "never divides an order money field by 100"), "maps line items with id/name/qty/price", "handles a zero / absent discount as 0"; `order-paid.handler.test.ts`: "forwards Charged via the client" |
| A8 | `orders/create` → `Order Created` and **never** `Charged` | `order-created.handler.test.ts`: "forwards Order Created", "**never emits Charged**"; `order-event.mapper.test.ts`: "orders/create maps to Order Created, not Charged" |
| A9 | Forwarding is **idempotent** — redelivered `orders/paid` sends no second `Charged` | `forwarding.service.test.ts`: "inserts a forwarded_events row before the outbound call", "a duplicate idempotency key does not call fetch a second time", "derives the key as `<event_type>:<order_id>`", "a crash between insert and update leaves status=failed (no silent gap)" |
| A10 | `orders/cancelled`, `orders/fulfilled`, `orders/partially_fulfilled`, `orders/updated` each forward their mapped event | `order-lifecycle.handlers.test.ts`: one case per topic, "forwards <CleverTap event> for <topic>" (4 cases) |
| A11 | `app/uninstalled` flips inactive, preserves config, pixel then 404s | `app-uninstalled.handler.test.ts`: "flips is_active=false and sets uninstalled_at", "preserves clevertap_configs", "no-ops for an already-inactive merchant (retry-safe)", "no-ops for an unknown merchant", "takes SELECT … FOR UPDATE before the update", "writes through trx, not the service"; `sdk.service.test.ts`: "404s after uninstall" |
| A12 | Forwarding **skipped entirely** when `server_events_enabled` false or passcode unset | `forwarding.service.test.ts`: "does not call fetch when serverEventsEnabled is false", "does not call fetch when passcode_enc is NULL", "records status=skipped", "does not throw" |
| A13 | `pnpm verify` green | §8 green-gate (CI, not a unit test) |
| A14 | No `// TEMPLATE:` markers remain | `code-reviewer` checklist + `wiring.test.ts`: "no TEMPLATE markers in the clevertap module, admin, or pixel" |

Additional cases below that map to TRD invariants rather than a numbered PRD
criterion are marked **(TRD)**.

---

## 3. Backend test cases

Location: `apps/backend/test/unit/apps/clevertap/`.

### 3.1 `bootstrap.test.ts`
Arrange a fake trx + `clevertap_configs`. Act `ClevertapBootstrap.run(trx, 'm1')`.
- seeds `{accountId:'', region:'in1', debug:false, serverEventsEnabled:false, events:<default map>}`
- **reinstall preserves** a pre-existing `accountId`/`passcode_enc` (ODKU self-update no-op)
- `events` is passed as a **JSON string**
- edge: bootstrap runs inside the caller's transaction (asserts it uses `trx`, never a fresh connection)

### 3.2 `config.service.test.ts`
- `getByMerchantId` returns the redacted shape; `passcodeSet` true iff `passcode_enc` non-null
- throws `NotFoundException` when no row exists
- **passcode tri-state (TRD §5):** absent → column untouched; `''` → set NULL; value → encrypted
- ciphertext ≠ plaintext; `decrypt(stored) === plaintext`
- `upsert` preserves `events` when the body omits it; merges when present
- rejects an invalid `region` before touching the DB
- **(TRD)** `serverEventsEnabled: true` with no passcode → rejected (can't enable without a credential)

### 3.3 `sdk.service.test.ts`
Covers A4 + the A3 prelude assertion. Key ordering case: **merchant-inactive must
win over config-missing** — assert the two lookups are sequential, not `Promise.all`.
- prelude shape: exactly `{accountId, region, apiHost, debug, merchantId, eventNameMap}` — assert the key set, so a future field addition is a deliberate test change
- prelude is emitted through `safe-inline-json` (assert `</script>` and `<` are escaped)
- pixel body is cached after first read (second call does not re-read the file)

### 3.4 `order-event.mapper.test.ts` — pure, the highest-value file
- one case per topic → correct CleverTap event name
- **money (reversed 2026-07-29):** `parseRupees` — parse, **never scale** — on the order total, the discount and every line item, plus a `*_set.shop_money.amount` fallback; table-driven `MONEY_CASES` covering decimal strings *and* numbers (`"1200.00"` and `1200` agree, `"0.00"` → `0`), and a named regression block for the ₹1,200 → `Amount: 1200` case
- `Charged` body carries `Amount`, a charge id, and `Items[]`
- phone normalised to `+91XXXXXXXXXX`; already-prefixed input is not double-prefixed
- missing/empty line items → empty `Items[]`, not a throw
- missing customer → event still maps (identity omitted rather than `undefined` leaking)
- **R2 guard:** a test asserting the fixture's price field is treated as an integer, so a shape change fails loudly here rather than silently shipping wrong revenue

### 3.5 `forwarding.service.test.ts`
Covers A9 + A12.
- inserts `clevertap_forwarded_events` **before** the outbound call; updates `status` after
- duplicate key → no second fetch, no throw
- CleverTap 5xx → `status='failed'`, `error` recorded, **handler still resolves** (so the platform gets 2xx and does not redeliver forever)
- CleverTap timeout → same
- skip paths (flag off / no passcode) → `status='skipped'`, zero fetches
- **(TRD)** the outbound request carries `X-CleverTap-Account-Id` + `X-CleverTap-Passcode` and posts to the **region-derived host** — assert per region via a table
- **(TRD)** the passcode never appears in any log call (spy the logger)

### 3.6 Webhook handler tests
`order-paid.handler.test.ts`, `order-created.handler.test.ts`,
`order-lifecycle.handlers.test.ts`, `app-uninstalled.handler.test.ts`,
`customer-created.handler.test.ts`, `customer-updated.handler.test.ts`.
- each: correct `topic` constant, delegates to the forwarding service with the mapped event
- `order-created`: explicit negative assertion that `Charged` is never emitted (A8)
- `customer-*`: profile upsert body includes `email_marketing_consent` / `sms_marketing_consent` when present; **inert-safe** — handlers must not throw if the topic never arrives (they simply aren't invoked)
- `app-uninstalled`: full case list in A11
- **(TRD/R1)** `topics.test.ts`: asserts every handler's `topic` value is a member of `CLEVERTAP_WEBHOOK_TOPICS` and that the set matches `STATE.json.webhooks` exactly — this is the guard against the silent topic-mismatch skip

### 3.7 `migration.test.ts` (structural)
Import `0001_initial.ts` and assert against a recording fake `db.schema`:
- creates `merchants`, `oauth_tokens`, `webhook_log`, `clevertap_configs`, `clevertap_forwarded_events`
- `clevertap_configs.merchant_id` is PK with FK → `merchants.id` ON DELETE CASCADE
- `clevertap_forwarded_events` has `UNIQUE (merchant_id, idempotency_key)` and `INDEX (merchant_id, sent_at)`
- `passcode_enc` is nullable `text`
- `down()` drops in reverse dependency order

### 3.8 `wiring.test.ts`
A1 + A14: `APPS` contains `clevertap`; module registered; `.env.example` has all
seven `RATIO_CLEVERTAP_*` keys; `01-database.sql` contains the `clevertap_app`
CREATE+GRANT; no `// TEMPLATE:` marker in the module/admin/pixel trees.

### 3.9 `clevertap-pixel.test.ts`
Covers A5 + A6, following `meta-pixel.test.ts`. Load the compiled pixel into a
happy-dom window with a stubbed `window.clevertap` (array + `push`) and a fake
runtime; drive events through the captured subscriber.

---

## 4. Frontend test cases

Location: `apps/admin-clevertap/src/`.

### 4.1 `routes/-config.test.tsx`
- renders loaded config; Account ID and Region populated
- **passcode field renders empty even when `passcodeSet` is true**, with a "saved — leave blank to keep" affordance (write-only semantics must be visible)
- submitting an untouched passcode field omits `passcode` from the PUT body (does **not** send `''`, which would clear it) — the highest-value frontend test
- explicit clear action sends `passcode: ''`
- invalid Account ID → inline error, no PUT
- Region select lists all `CLEVERTAP_REGIONS` and shows the matching dashboard URL
- "Enable server-side order events" is **disabled** until a passcode is saved
- save failure surfaces an error and does not clear the form

### 4.2 `components/EventMapTable.test.tsx`
- renders all 13 OpenStore events with default CleverTap names
- renaming an event marks the form dirty and PUTs the new map
- disabling an event removes it from the submitted map
- blank name → validation error

### 4.3 `components/ScriptTagPanel.test.tsx`
- shows the exact `<script src=".../clevertap/sdk/<merchantId>.js" defer>` snippet for the current merchant
- copy action puts that string on the clipboard

### 4.4 `routes/-status.test.tsx`
- renders `configComplete` / `serverEventsEnabled` / `lastEventAt`
- empty state when no events have been forwarded
- surfaces `lastError` when the most recent forward failed

### 4.5 `useIframeAuth` / inactive merchant
- an inactive merchant is routed to `/disabled` rather than the config form (moengage behaviour)

---

## 5. Shared-schema test cases

`packages/shared/` — `clevertap-config.test.ts`:
- `accountId`: accepts a valid ID; rejects empty, >64 chars, and disallowed characters; trims. **R4** — if the real charset is wider, this test is the single place to widen it
- `region`: accepts each of the 6 keys; rejects `'IN1'` (case) and unknown values
- `debug` / `serverEventsEnabled` default to `false` when omitted
- `events` validates against `eventMapSchema`; rejects an unknown OpenStore key
- input schema: `passcode` optional, accepts `''`, rejects whitespace-only
- output schema: has `passcodeSet`, and **has no `passcode` key at all** (type-level + runtime assertion)
- `clevertap-events.test.ts`: `DEFAULT_CLEVERTAP_EVENT_MAP` has an entry for **every** `OPEN_STORE_EVENT_NAMES` member (the `satisfies` guarantee, asserted at runtime too); `Purchase` maps to `Charged`; every `CLEVERTAP_REGIONS` entry has `label`/`apiHost`/`dashboard` and an `apiHost` matching `https://<key>.api.clevertap.com`

---

## 6. Fixtures & helpers

`apps/backend/test/unit/apps/clevertap/helpers/`:

| File | Contents |
|---|---|
| `fake-clevertap-db.ts` | In-memory Kysely-shaped fake for `merchants`, `clevertap_configs`, `clevertap_forwarded_events`, `webhook_log`, incl. unique-constraint simulation on `(merchant_id, idempotency_key)` — A9 depends on that throwing. |
| `fakes.ts` | `makeMerchant({isActive})`, `makeConfig({accountId, passcodeEnc, region, serverEventsEnabled, events})`, `makeCrypto()` (fixed key), `makeFetch()` (records calls, scriptable status/latency), `makeLogger()` (spy). |
| `fixtures/order-payloads.ts` | **The OFFICIAL docs' order payload, verbatim** (`officialOrderPayload`) plus all **eight** topic variants derived from it by changing only `event_type` and the status fields: `ordersCreatePayload`, `ordersUpdatedPayload`, `ordersPaidPayload`, `ordersFulfilledPayload`, `ordersPartiallyFulfilledPayload`, `ordersCancelledPayload`, and `ordersEditedPayload` / `ordersDeletePayload` (real topics with no v1 handler). **Decimal rupee strings**, `customer: null`, top-level `phone`/`email`, UTC `Z` timestamps. Plus the identity-chain and degraded fixtures and `MONEY_CASES`. The `// R2: unverified` markers are gone — R2 is resolved. |
| `fixtures/customer-payloads.ts` | `customersCreatePayload`, `customersUpdatePayload` (incl. both consent flags). |
| `fixtures/envelopes.ts` | `makeEnvelope(event_type, body)` → `{event_type, merchant_id, …}`, plus a valid/invalid `x-openstore-signature` pair. |
| `helpers/pixel-harness.ts` | Builds a happy-dom window with a stubbed `window.clevertap`, an optional fake runtime, and a helper to emit an OpenStore event with/without `metadata.user_data`. |

---

## 7. Deployment contract checks

- [x] PRD, TRD, and `STATE.json.deployment` all say `apiPlacement: shared`, `workerPlacement: none` — asserted by `wiring.test.ts`: "deployment placement agrees across PRD, TRD and STATE".
- [x] Worker placement is `none`, so `wiring.test.ts` additionally asserts **no** worker flag, queue, consumer, or `*_WORKER_ENABLED` env key is introduced for `clevertap`.
- [x] No repository-local Kubernetes manifests are added (the `ENABLED_MODULES` + secret change is external GitOps).

---

## 8. Definition of done

- [ ] `pnpm verify` green (lint → typecheck → shared build → tests → builds), per the Definition of Done in `AGENTS.md`
- [ ] Every acceptance criterion A1–A14 has at least one passing test (§2 — no orphan criteria, no orphan tests)
- [ ] `topics.test.ts` passes, proving the handler topic set matches `STATE.json.webhooks` exactly (the R1 silent-skip guard)
- [ ] No `// TEMPLATE:` markers in `modules/clevertap`, `apps/admin-clevertap`, or `pixel/clevertap-pixel.ts`
- [ ] No secret committed; passcode absent from all GET responses, the pixel prelude, and all log output
- [ ] Change journal entry created at `docs/agent/apps/clevertap/CONTEXT.md` and `FEATURES.md` updated (feature-tier DoD)

**Pre-existing failures are not this build's to fix.** The `loyalty` build recorded
that `pnpm -r test` already fails for unrelated reasons (`apps/admin-rp` has no test
files and exits 1; two `meta` paging tests). Verify the `clevertap` suites are green
in isolation and report any pre-existing red separately at GATE 4 rather than
absorbing it.
