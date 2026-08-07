# clevertap — context

Living context for the CleverTap app (customer engagement platform — WhatsApp,
push, email, behavioural segmentation). Read before touching this module.
Standing context first; dated change journal below (newest first).

## Standing context

- **Two delivery paths**, unlike MoEngage/PostHog which are pixel-only:
  1. **Client-side pixel** — `pixel/clevertap-pixel.ts` → `static/clevertap-pixel.js`,
     served per-merchant at `/clevertap/sdk/:merchantId.js`.
  2. **Server-side forwarding** — order/customer webhooks → CleverTap's Events
     API (`POST {apiHost}/1/upload`).
- **The Passcode is a SECRET** — this is the main structural difference from
  MoEngage. `clevertap_configs.passcode_enc` is encrypted at rest via
  `CryptoService`, and the module injects `CLEVERTAP_CRYPTO` (MoEngage
  deliberately does not). Write-only tri-state on PUT (wizzy's pattern):
  key **absent** → untouched · `''` → cleared · value → encrypted. **The admin
  must OMIT the key when the field is untouched** — sending `''` wipes the
  merchant's credential.
- **The passcode never leaves the server**: absent from every GET response, from
  the pixel prelude, and from all log output. Pinned by tests.
- **`Charged` fires ONLY from `orders/paid`.** `orders/create` maps to
  `Order Created`. The guard is *structural*, not a comment — the event name is
  looked up from `CLEVERTAP_WEBHOOK_EVENT_NAMES[topic]` inside the mapper, so a
  handler cannot name a CleverTap event at all. Do not reintroduce a
  hand-written name. Both topics fire for one prepaid order; naming `Charged`
  twice would double-count revenue.
- **ORDER money is RUPEES — the order mapper must NOT divide by 100.** The
  platform's official webhook docs
  (https://sandbox-developers.dev.gokwik.in/docs/webhooks/topics, Orders) state
  that `total_price`, `subtotal_price`, line-item `price` and every
  `*_set.shop_money.amount` are in **rupees**, shipped as decimal strings
  (`"1200.00"`). `events/order-event.mapper.ts` parses with `parseRupees` and
  scales nothing; a ₹1,200 order is `Amount: 1200`. It used to divide, which
  reported that same order as ₹12 — a 100× revenue **under**-report.
  ⚠️ **`products/*` webhooks ARE integer paise** (`learnings.md` 2026-06-22,
  live delivery: `price: 155900` = ₹1,559), so *orders = rupees, products =
  paise* — both true at once. **The pixel also does NOT divide**: the OpenStore
  pixel bus already emits major units (see `google-pixel.test.ts`). Three paths,
  and only the product path is minor units. Tested on all sides.
- **Every forwarded record MUST carry an `identity`.** CleverTap rejects a record
  with none of `identity`/`objectId`/`FBID`/`GPID` with **error 523** — the whole
  event, not just the field. The official order payload has `customer: null` AND
  `customer_id: null`, with `email`/`phone` at the **top level**, so identity is
  derived in priority order: top-level `phone` → `customer.phone` → top-level
  `email` → `customer.email` → `customer_id` → `customer.id`. When none exists
  the mapper returns `null` and forwarding records `status='skipped'` with the
  reason (a payload problem, never `failed`). Phone stays first because it is
  India's CleverTap identity and the `+91` normalisation prevents error 516.
- **Outbound idempotency** lives in `clevertap_forwarded_events`, UNIQUE on
  `(merchant_id, idempotency_key)` where the key is `<event_type>:<resource_id>`
  (the envelope carries no delivery id). The row is INSERTed *before* the
  outbound call and updated after. Note the honest scope of that guarantee: the
  row lives in the dispatch transaction, so a rollback discards it *with* the
  `webhook_log` row and Ratio's retry re-runs cleanly — what insert-first buys is
  that no *committed* state can have a sent CleverTap event with no row.
- **A CleverTap outage must not wedge the platform**: a 5xx/timeout marks the row
  `failed` and the handler still resolves, so Ratio gets its 2xx and stops
  redelivering. Failures surface in the admin status screen, not the retry queue.
- **Forwarding is skipped entirely** (`status='skipped'`, zero fetches, no throw)
  when `server_events_enabled` is false or `passcode_enc` is NULL.
- **9 webhook topics**, all verified against the live platform registry:
  `app/uninstalled`, `orders/paid|create|cancelled|fulfilled|partially_fulfilled|updated`,
  `customers/create|update`. Constants in `webhooks/topics.ts` — a topic string
  that doesn't match the delivered `event_type` makes the dispatcher **silently
  skip** the handler.
- **All 9 handlers must appear in BOTH `providers` and `handlerClasses`** in
  `clevertap.module.ts`. `createAppProviders` does
  `inject: [dbToken, ...handlerClasses]`, so a handler missing from `providers`
  fails DI **at boot** — and nothing in this repo compiles a Nest module in
  tests. `wiring.test.ts` has 12 guard tests pinning that symmetry.
- **Regions:** `in1` (default — Indian merchant base), `eu1`, `sg1`, `us1`,
  `aps3`, `mec1`. `apiHost` = `https://<region>.api.clevertap.com`. ⚠️ CleverTap's
  Web SDK README does **not** list `eu1`, so an `eu1` merchant may get a
  browser-side region fallback (TRD R12).
- **Identity bridge — read this before touching the pixel.** ⚠️ **KwikPass auth is
  NEVER published on the OpenStore bus** (`meta-pixel.ts` says so twice from live
  experience), so a `metadata.user_data`-only bridge identifies nobody at the OTP
  moment — which silently destroys the PRD's whole identity moat. That was the
  original bug here; fixed 2026-07-26. Identity is now multi-source and
  priority-ordered: (1) `window.__openstore_user` — the storefront's canonical
  published PII; (2) origin-gated GoKwik `postMessage`
  (`/(^|\.)gokwik\.(co|com|in|io)$/i`, types `otpVerifiedGk` / `kp_token`, plus
  cart messages carrying `email`/`phone`, which we copy INTO `__openstore_user` so
  every Ratio pixel shares one identity view); (3) the `user-loggedin` /
  `user_loggedin_merchant` window CustomEvents; (4) `metadata.user_data` as a
  gap-filler. **The origin regex is a security control** — never accept identity
  PII from another origin. Wired at load, not in `register()`, and the SDK inits
  on demand so a pure-OTP login preceding `register()` still identifies. Deduped
  on an identity signature (one `onUserLogin` per identity across all sources);
  re-identifies on A→B; a KwikPass token probe distinguishes a real logout from a
  transient PII gap before clearing. Still **no KwikPass code change needed** —
  we only consume signals KwikPass already emits.
- **Migration history is folded**: only `0001_initial.ts` exists. 0002/0003 were
  deleted (the DB is new; 0003 narrowed `api_key`/`host` which never existed here,
  and 0002 dropped an index 0001 had just created). `idx_webhook_log_unprocessed`
  is therefore never created. Pinned by `migration.test.ts`. Do not restore them.
- **Only ONE decrypt path exists** — `ClevertapForwardingService`, which reads
  config through the dispatch `trx`. A second one on `ClevertapConfigService` was
  removed: it read outside the transaction and collapsed an undecryptable
  ciphertext into `passcode: null`, which forwarding logged as `skipped` —
  indistinguishable from "never configured", where the honest status is `failed`.
- **Storefront install is a 2-step `next/script` install, NOT paste-into-head.**
  Step 1: `<Script src="{base}/clevertap/sdk/{merchantId}.js" strategy="afterInteractive" />`
  in `src/app/layout.tsx`. Step 2: `"clevertap-ratio": {},` in
  `src/config/pixelConfig.ts`. The `pixelConfig` key must equal the pixel's
  registered `name` in `pixel/clevertap-pixel.ts` — if they diverge the
  PixelRuntime silently never activates the SDK. ⚠️ `admin-moengage` and
  `admin-posthog` still show the **superseded** raw-`<script defer>` form and the
  stale `apps/<merchant>/lib/pixelConfig.ts` path; do not copy them. The correct
  references are `_template-admin`, `admin-google`, `admin-loyalty`, per
  `docs/agent/changes/pixel-install-ux/SPEC.md`. `ScriptTagPanel.test.tsx` has
  regression guards asserting the old form cannot come back.
- **Local dev:** `RATIO_CLEVERTAP_*` block in `.env` (6 keys — there is no
  `WEBHOOK_SECRET`; inbound HMAC uses `RATIO_CLEVERTAP_CLIENT_SECRET`).

## Open blockers

See `TODO.md` for the full list. The two that matter:

- **No `checkouts/*` topic exists on the platform at all** → no server-side
  checkout abandonment in v1, the source PRD's headline use case. Degrades to the
  pixel's client-side `InitiateCheckout`.
- **`customers/*` needs TWO things** before it can ever work: the UAT registry
  sync (18 of 21 events synced) **and** a `core/` change — `envelopeResource`
  reads only `product ?? order`, so a customer delivery arrives as `{}`.

## Change journal

### 2026-07-29 — official webhook docs land: two FATAL order-mapper bugs fixed

- The platform's official webhook docs
  (https://sandbox-developers.dev.gokwik.in/docs/webhooks/topics) resolved **TRD
  R2**, which had been guessed. Two consequences, both shipping-blocking:
  1. **Money was divided by 100 when it must not be.** Order monetary fields are
     already **rupees** (decimal strings), so `paiseToRupees` turned a ₹1,200
     order into `Amount: 12` and a ₹600 line into `Price: 6` — a 100× revenue
     **under**-report on every `Charged`. `paiseToRupees`/`PAISE_PER_RUPEE` are
     gone from the mapper, replaced by `parseRupees` (parse, never scale) plus a
     `*_set.shop_money.amount` fallback. **`products/*` is still paise** — that
     asymmetry is now spelled out in the standing context above and in the
     mapper's header so nobody "fixes" it back.
  2. **No identity was emitted, so CleverTap rejected the whole event (523).**
     The real payload has `customer: null` / `customer_id: null` with
     `email`/`phone` at the top level; the mapper only looked at
     `order.customer`. It now walks phone → customer.phone → email →
     customer.email → customer_id → customer.id, and returns `null` when nothing
     is usable — which `forwardOrder` records as `skipped` with the reason
     instead of a phantom `failed`.
- `helpers/fixtures/order-payloads.ts` is now the docs' own sample payload, with
  the eight per-topic variants derived from it by changing only `event_type` and
  the status fields. All `// R2: unverified` comments are gone.
- Also learned: all eight order topics deliver the **identical** order object;
  `line_items` is always present while `customer`/`shipping_address`/
  `billing_address` are null when not supplied; timestamps are ISO-8601 **UTC
  with `Z`**, not the `+05:30` IST the source product PRD claimed (nothing in
  this module assumed IST, so no code change was needed).
- `orders/edited` and `orders/delete` are real platform topics with no handler in
  v1 (out of scope). They are NOT in `CLEVERTAP_WEBHOOK_EVENT_NAMES` — that table
  is pinned 1:1 to the registered handlers and `STATE.json.webhooks` — but
  `deriveOrderEventName` gives them sane names (`Order Edited` / `Order Deleted`)
  so a stray delivery can never produce `evtName: undefined` (CleverTap 509).
- Suite: 405 → **448** clevertap unit tests, all green.

### 2026-07-25 — initial build (PRD → TRD → TDD → scaffold → build)

- Built from `update/Clevertap - PRD.md` (a Ratio **platform** PRD, not a
  vendor-app PRD) through the full `build-app` lifecycle in a dedicated worktree
  off `origin/main`. Seven deviations D1–D7 recorded in `PRD.md`; the two that
  removed dependencies: the app calls CleverTap's public Events API rather than
  requiring CleverTap to add Ratio as a platform (deletes the source PRD's only
  H-likelihood risk), and identity comes from the pixel bus rather than a
  KwikPass JS change (deletes an external-team dependency).
- Scope was grounded on the **live** platform registry, which corrected two
  successive wrong readings: `orders/paid` and both fulfilment topics DO exist,
  and `customers/*` is defined-but-unsynced rather than missing. See the
  two-registry entry in `context/learnings.md` (2026-07-25).
- Implementation ran as a 4-agent parallel workflow over disjoint file trees.
  350 CleverTap tests (309 backend + 41 admin), workspace typecheck clean, lint
  clean, all builds green.
- Fixed a **pre-existing** repo failure in passing: `test/unit/config/env.schema.test.ts`
  was missing `RATIO_LOYALTY_*` from its `validEnv` fixture (loyalty joined `APPS`
  in PR #37 without it), failing 6 tests on `main`.
- **Files:** `apps/backend/src/modules/clevertap/**` (28), `apps/admin-clevertap/**` (32),
  `apps/backend/pixel/clevertap-pixel.ts`, `apps/backend/test/unit/apps/clevertap/**` (22),
  `packages/shared/src/{constants/clevertap-events,schemas/clevertap-config}.ts`,
  plus `APPS` / `module-registry.ts` / `01-database.sql` / `.env.example` wiring.
