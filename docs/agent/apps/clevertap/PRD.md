# PRD — CleverTap

> Structured by `prd-architect` from the source product PRD at
> `update/Clevertap - PRD.md` (Ratio platform PRD, Aakash Singh, v1.0,
> 2026-05-27). **The source PRD is a platform-team PRD, not a `ratio-apps`
> vendor-app PRD** — it assumes two pieces of Ratio platform infrastructure
> (ScriptTag API, App Webhook Subscription API) that do not exist in this repo.
> §"Deviations from the source PRD" records every place this PRD diverges and
> why. Read that section before GATE 1.

## Vendor name & slug

- **Display name:** CleverTap
- **Slug:** `clevertap`
- **Storefront SDK?** `no` — CleverTap is an analytics/engagement pixel, not a
  search/discovery widget. It follows the MoEngage/PostHog pixel pattern
  (`apps/backend/pixel/<slug>-pixel.ts` served at `/<slug>/sdk/:merchantId.js`),
  not the `packages/<slug>-sdk` Lit-widget pillar. `hasStorefrontSdk: false`.
- **API placement:** `shared` *(recommended — awaiting GATE 1 confirmation)*
- **Worker placement:** `none` *(recommended — awaiting GATE 1 confirmation)*
- **Placement rationale:** Request load is one cached pixel GET per storefront
  page (served from an in-process cached string, same as MoEngage) plus a small
  number of webhook POSTs per order. No queue consumer, no latency-sensitive or
  failure-isolated path, no heavy secrets handling. This is the same profile as
  MoEngage and PostHog, both of which are `shared` / `none`. Revisit only if
  server-side event forwarding volume proves to need retry isolation.

## Problem

Enterprise Indian D2C brands (100Cr+ GMV — Wellversed, Plix, BBlunt, Aqualogica)
run their lifecycle marketing on CleverTap: behavioural segmentation, RFM
cohorts, and multi-channel campaigns (WhatsApp, mobile/web push, email, SMS).
When a brand migrates its storefront to Ratio, that data pipeline breaks —
CleverTap stops receiving storefront behaviour and purchase events, so
segments go stale, abandoned-cart Journeys stop firing, and revenue attribution
dies. The source PRD scores this as a hard migration blocker: the merchant either
stays on Shopify or loses their engagement stack.

The user is the merchant's in-house marketing team. They need to install
CleverTap on their Ratio store themselves, paste one script tag, enter their
CleverTap credentials, and have storefront + purchase events flowing into their
existing CleverTap project without Ratio engineering involvement.

Two things make this more than a straight port of the MoEngage app:

1. **Identity.** Every Ratio checkout authenticates by phone through KwikPass.
   The source PRD's central claim is that emitting that phone identity to
   CleverTap (`onUserLogin`) identifies 100% of checkout initiators — including
   guests who abandon — where Shopify leaves them permanently anonymous. In this
   repo that identity already rides on OpenStore pixel events as
   `metadata.user_data`, so the bridge is a mapping concern, not a KwikPass code
   change (see Deviations D4).
2. **Purchase reliability.** A browser-fired `Charged` event is lost to ad
   blockers and closed tabs. Server-side order webhooks are the reliable path,
   so this app forwards orders to CleverTap's server-side Events API in addition
   to the pixel.

## Data model (tables / fields)

One new table beyond the standard `merchants`, `oauth_tokens`, and `webhook_log`
that every module already has.

| Table | Column | Type | Notes |
|---|---|---|---|
| `clevertap_configs` | `merchant_id` | varchar(128) PK | FK → `merchants.id` |
| | `account_id` | varchar(64) NOT NULL | CleverTap Account ID. Not a secret (it ships to the browser in the pixel prelude). Default `''` on install-seed. |
| | `passcode` | text NULL | CleverTap **Passcode** — **SECRET, encrypted at rest** via `core/crypto`. Server-side Events API credential; never sent to the browser. |
| | `region` | varchar(8) NOT NULL | CleverTap region code (`in1`, `eu1`, `sg1`, `us1`, `aps3`, `mec1`). Drives both the SDK `region` init and the server-side API host. Default `in1` (Indian merchant base). |
| | `clevertap_enabled` | boolean NOT NULL | **Per-merchant kill switch** for the whole integration (pixel + all server forwarding + catalog). Default `true`. Mirrors the fleet `<vendor>_enabled` convention (`forms_enabled`, etc.). The roadmap referred to this as `clevertap_app_enabled`; the shipped name is `clevertap_enabled` to stay consistent with the fleet. Soft-stop — the admin stays fully usable. Distinct from `merchants.is_active` (uninstall). See "Kill switch" below. |
| | `server_events_enabled` | boolean NOT NULL | Master switch for server-side order forwarding. Default `false` — turns on only once the merchant has entered a passcode. |
| | `debug` | boolean NOT NULL | Verbose pixel console logging. Default `false`. |
| | `events` | json NOT NULL | OpenStore → CleverTap event-name map (`eventMapSchema`), seeded from `buildDefaultEventMap('clevertap')`. Merchant-renamable. |
| | `catalog_name` | varchar NOT NULL | CleverTap catalog name for product-catalog sync. Default `''`. |
| | `catalog_email` | varchar NOT NULL | Admin email required by the CleverTap catalog upload API. Default `''`. |
| | `catalog_sync_enabled` | boolean NOT NULL | Enables product-catalog CSV sync (independent of the kill switch, which gates it too). Default `false`. Also gated by `CLEVERTAP_CATALOG_CONTRACT_VERIFIED` until go-live. |
| | `created_at` / `updated_at` | datetime(3) | Standard. |

**Difference from MoEngage:** MoEngage stores only a non-secret App ID and
deliberately skips `CryptoService`. CleverTap's Passcode **is** a write
credential, so this module injects `CLEVERTAP_CRYPTO` and encrypts that column —
the `_template` already wires this; do not fork it.

## Scopes / permissions

- `read_orders` — required to receive `orders/*` webhooks and read the order
  payload (line items, totals, payment method) that becomes CleverTap's
  `Charged` event and drives RFM profile attributes.

- `read_customers` — required for the `customers/create` and `customers/update`
  subscriptions (defined in the platform catalog; pending UAT sync — see Webhook
  events). These carry the marketing-consent flags CleverTap needs to enforce
  opt-out, which no other event supplies.

`read_products` is not requested — catalog sync is out of scope for v1 (D6).

## Webhook events

**R1 RESOLVED (2026-07-25).** Scope is grounded on the **live platform
registry**, not repo inference. Note there are **two registries and they differ**
— reading only one is how an earlier draft of this PRD got the scope wrong:

| Endpoint | Meaning | Count |
|---|---|---|
| `GET /api/v1/admin/webhook-setup/event-definitions` | **Master catalog** — every event the platform defines. This is what the merchant-facing dashboard renders. | **21** in 6 categories: orders ×8, products ×3, collections ×3, **customers ×3**, reviews ×2, loyalty ×2 |
| `GET /api/v1/admin/webhook-setup/event-types` | **Synced registry** — definitions actually wired into the processor and deliverable *today* in UAT. | **18** — the catalog minus all 3 `customers/*` |
| `GET /api/v1/admin/webhook-setup/status` | Confirms the drift explicitly | `eventTypeCount: 18`, `expectedEventCount: 21`, `processorHealthy: true` |

So `customers/*` is **defined and real** — the catalog entry carries its own Kafka
topic (`sandbox.os.ecosystem.customer.events`, groupId `webhook.customers`) — it
is simply **not yet synced** in UAT. A `POST /api/v1/admin/webhook-setup/sync`
closes the 3-event gap; this is an ops action, not platform development.

Deliveries are slash-form `event_type` strings in a
`{ event_type, merchant_id, ... }` envelope signed with
`x-openstore-signature: sha256=<hex>` (`docs/agent/context/learnings.md`,
2026-06-18). Apps self-register subscriptions via
`POST /api/v1/app-webhooks` (`{ eventName, webhookUrl, secretKey?, customHeaders? }`).

**In scope for v1** — all verified present on the platform:

| Topic | CleverTap event | Handler behaviour |
|---|---|---|
| `app/uninstalled` | — | Flip merchant inactive (default template wiring). Soft delete: preserve `clevertap_configs` so reinstall restores settings; the pixel endpoint then 404s. |
| `orders/paid` | **`Charged`** | **Primary purchase event.** Forward to CleverTap's server-side Events API with full line items, paise→rupees. This is the browser-independent revenue-attribution path and the trigger for post-purchase Journeys. |
| `orders/create` | `Order Created` | Order placed (fires before payment confirmation; COD and prepaid alike). Does **not** map to `Charged` — `orders/paid` owns that, exactly as the source PRD intends. |
| `orders/cancelled` | `Order Cancelled` | Lets merchants suppress post-purchase Journeys for cancelled orders. |
| `orders/fulfilled` | `Order Fulfilled` | Powers shipping/delivery notification Journeys. |
| `orders/partially_fulfilled` | `Order Partially Fulfilled` | Same, partial shipments. |
| `orders/updated` | `Order Updated` | P1 in the source PRD; cheap to include since the handler shape is shared. |

| `customers/create` | `Customer Created` (profile) | **Defined; pending UAT sync.** Creates the CleverTap profile server-side — covers customers created via admin or import who never have a storefront session. |
| `customers/update` | `Customer Updated` (profile) | **Defined; pending UAT sync.** Propagates profile attribute changes — most importantly `email_marketing_consent` / `sms_marketing_consent`, which CleverTap needs to enforce opt-out correctly. |

Build the two `customers/*` handlers in v1 — the code is trivial and identical in
shape to the order handlers — and let the sync land independently. If it has not
landed by QA they are simply inert: the platform never delivers those topics and
nothing else breaks. `customers/delete` is also defined and is the natural home
for the GDPR deletion flow the source PRD defers; **not** wired in v1
(`TODO.md` §2).

**Genuinely absent from the catalog — real platform asks.** Seven of the source
PRD's topics appear **nowhere** in the 21-event definitions catalog (verified:
zero occurrences of `checkouts`, `fulfillments`, or `draft_order` in the
response): `checkouts/create`, `checkouts/update`, `checkouts/delete`,
`fulfillments/create`, `fulfillments/update`, `draft_orders/create`,
`draft_orders/update`. See **`TODO.md` §1**. The material consequence:
**server-side checkout abandonment has no path in v1**, so abandonment degrades
to the pixel's client-side `InitiateCheckout` — good enough to trigger a
CleverTap Journey, but browser-dependent and not server-authoritative.

**Available but unused in v1** (candidates for v1.1, noted so they aren't
rediscovered): `orders/edited`, `orders/delete`, `products/*`, `collections/*`,
`reviews/create`, `reviews/update`, `loyalty/points_credited`,
`loyalty/points_debited`. The loyalty pair is a genuine fit for the source PRD's
"loyalty tier update notification" use case, and `reviews/*` for post-purchase
review Journeys.

## Admin screens

Three routes in the admin SPA (`apps/admin-clevertap`), mirroring the MoEngage
admin's shape.

- **Config** — Account ID (required); Passcode (secret — write-only field,
  rendered masked, never returned by the GET); Region (select, defaults `in1`,
  shows the matching CleverTap dashboard URL as guidance); "Enable server-side
  order events" toggle (disabled until a passcode is saved); Debug toggle.
  Validation via a shared Zod schema.
- **Events** — table of the 13 OpenStore event names with their CleverTap
  target names, each renamable and individually enable/disable-able. Seeded from
  `DEFAULT_CLEVERTAP_EVENT_MAP`.
- **Install / status** — the `<script>` snippet to paste into the storefront
  (`/clevertap/sdk/<merchantId>.js`), plus a readiness summary: config complete?
  server events on? last webhook received? Mirrors the MoEngage
  `ScriptTagPanel`.

## Acceptance criteria

- [ ] `clevertap` is appended to the `APPS` tuple, registered in
      `module-registry.ts`, has its `RATIO_CLEVERTAP_*` block in `.env.example`,
      and its MySQL CREATE+GRANT in `docker/mysql/init/01-database.sql`.
- [ ] OAuth install seeds a `clevertap_configs` row (ON DUPLICATE KEY UPDATE
      no-op) so the admin GET never 404s, and a **reinstall does not clobber**
      an existing Account ID / Passcode.
- [ ] Merchant can save config; `passcode` is **encrypted at rest** (verified by
      reading the raw column) and is **never** returned by
      `GET /clevertap/api/clevertap-config` nor present in the pixel prelude.
- [ ] `GET /clevertap/sdk/:merchantId.js` returns JS with a
      `window.__CLEVERTAP_RATIO_CONFIG__` prelude for an active, configured
      merchant; 404 `MERCHANT_INACTIVE` for an uninstalled merchant; 404
      `CONFIG_INCOMPLETE` when `account_id` is empty. `Cache-Control` is set on
      the success path **only** (never on 404/503).
- [ ] The pixel loads the CleverTap Web SDK for the configured region, registers
      with `window.__OPEN_STORE_PIXEL_RUNTIME__` (queuing via
      `__OPEN_STORE_PIXEL_PENDING__` if it is not ready), and forwards each
      enabled OpenStore event under its mapped CleverTap name.
- [ ] Identity bridge: when an event carries `metadata.user_data`, the pixel
      calls `clevertap.onUserLogin.push({Site:{Identity, Phone, Email, Name}})`
      once per identity, with phone normalised to `+91XXXXXXXXXX`; a user switch
      re-identifies; logout clears. No duplicate `onUserLogin` for an unchanged
      identity.
- [ ] `orders/paid` forwards a **`Charged`** event to CleverTap's server-side
      Events API with line items, and **monetary values converted from integer
      paise to rupees** (`docs/agent/context/learnings.md` 2026-06-22 —
      platform prices are paise; the source PRD's "decimal rupees" claim is
      wrong for Ratio, see D5).
- [ ] `orders/create` forwards `Order Created` and **does not** emit `Charged`
      — no double-counting of revenue when both topics fire for one order.
- [ ] Server-side forwarding is **idempotent** — a redelivered `orders/paid`
      does not produce a second `Charged` event (key derived from the order id,
      since the envelope carries no delivery id).
- [ ] `orders/cancelled`, `orders/fulfilled`, `orders/partially_fulfilled`, and
      `orders/updated` each forward their mapped CleverTap event.
- [ ] `app/uninstalled` flips the merchant inactive, preserves the config row,
      and the pixel endpoint subsequently 404s.
- [ ] Server-side forwarding is skipped entirely (no outbound call, no error)
      when `server_events_enabled` is false or the passcode is unset.
- [ ] With `clevertap_enabled` false (kill switch), the pixel route serves an
      inert no-op body, every server forward records a `skipped` row without
      calling CleverTap, and the admin stays fully usable (soft-stop). See
      "Kill switch" below.
- [ ] `pnpm verify` is green (workspace lint + typecheck, shared build, tests,
      builds), and `pnpm -r lint && pnpm -r typecheck && pnpm -r build` pass.
- [ ] No `// TEMPLATE:` markers remain in the module, admin, or pixel.

## Kill switch — two levels

Two independent off-switches, both from the v1 rollout roadmap (not the source
PRD), enforced at the same three data-path choke points. Either one disables the
integration; the admin stays fully usable (soft-stop). Distinct from
`merchants.is_active` (uninstall → hard 404 + `/disabled`).

- **Per-merchant** — `clevertap_enabled` column, default `true`. (Roadmap called
  it `clevertap_app_enabled`; shipped as `clevertap_enabled` for fleet
  consistency with `forms_enabled` etc.) Toggled from the admin config form.
  Skip reason recorded as `app disabled`.
- **Platform-wide** — `CLEVERTAP_APP_ENABLED` env var, default `'true'`. `'false'`
  disables CleverTap for **all merchants at once** (regression kill switch),
  regardless of any merchant's own toggle, and takes precedence over it. Read at
  boot via `ConfigService`, so flipping it needs a restart/redeploy. Skip reason
  recorded as `platform disabled`.

Enforced on the **data path only**, at three choke points (both switches):

- **Pixel** (`sdk.service.render`): serves an inert no-op body
  (`/* CleverTap disabled for this merchant */`) with `Cache-Control: no-store`
  — *not* a 404 (a 404 logs console errors on the storefront) and *not* the
  5-min success TTL (so re-enabling takes effect on the next page load).
- **Server forwarding** (`forwarding.service.skipReasonFor`): returns
  `'app disabled'` **before** the `server_events_enabled` check, so every
  order/loyalty/review forward records a `skipped` row and never calls CleverTap.
- **Catalog sync** (`catalog-sync.service.skipReasonFor`): returns
  `'app disabled'`, distinct from the `catalog_sync_enabled`-off reason.

**Actual cutover behavior** (correcting the roadmap's platform-era description):

- The **server path is instant** (synchronous, uncached flag check per webhook)
  — this is the billing/revenue-critical surface.
- The **pixel has a ≤5-min tail on disable**: a browser/CDN holding the cached
  *enabled* pixel keeps running it until its `max-age=300` expires; Ratio cannot
  retroactively unload an SDK already in a live page. Re-enabling is fast
  (disabled body is `no-store`).
- Webhooks arriving while paused are recorded `skipped` and are **not replayed**
  on re-enable (there is no delivery queue — forwarding is synchronous, `worker:
  none`). No subscription is removed, so re-enabling resumes on the next event
  with no re-registration and no data corruption.
- The KwikPass `onUserLogin` is emitted by **our pixel**, not by KwikPass JS
  (see D4), so when the pixel is inert no identity is sent — no KwikPass change
  is involved either way.

## Deviations from the source PRD

The source PRD targets the Ratio **platform** team. These are the points where
this build cannot or should not follow it, with the reason. **Each is a decision
for GATE 1.**

| # | Source PRD says | This build does | Why |
|---|---|---|---|
| **D1** | CleverTap's SDK is injected automatically on every storefront page via the **ScriptTag API** | Merchant pastes one `<script src="/clevertap/sdk/<merchantId>.js" defer>` into the storefront | The ScriptTag API does not exist in this repo (the source PRD lists it as a hard, not-yet-shipped dependency). Every shipped pixel vendor here — MoEngage, PostHog, Google, Meta — uses the pasted-script pattern. Wizzy's ScriptTag auto-injection is still `pending_api`. |
| **D2** | CleverTap registers **15 webhook topics** via a self-serve subscription API, including `customers/*`, `checkouts/*`, `orders/paid`, `orders/fulfilled`, `fulfillments/*`, `draft_orders/*` | Subscribes to **9 topics**: `app/uninstalled`, `orders/paid`, `orders/create`, `orders/cancelled`, `orders/fulfilled`, `orders/partially_fulfilled`, `orders/updated`, `customers/create`, `customers/update`. The remaining **7 are tracked in `TODO.md` §1** as platform asks. | R1 read the live registries instead of inferring from this repo, and **corrected two successive wrong readings of mine.** The source PRD is largely right: `orders/paid` (its primary `Charged` trigger) exists; both fulfilment topics it thought were blocked on the Fulfillment Module exist; and `customers/*` is defined in the master catalog — it is only missing from UAT's *synced* registry (18 of 21), which a `webhook-setup/sync` closes. What genuinely does not exist anywhere is `checkouts/*`, `fulfillments/*`, and `draft_orders/*`. **Consequence: server-side checkout abandonment — the source PRD's headline use case — has no path in v1** and degrades to the pixel's client-side `InitiateCheckout`. |
| **D3** | Webhook payloads are **Shopify-identical JSON**, so CleverTap's existing Shopify mapping works drop-in with zero CleverTap-side changes | This app **transforms** Ratio payloads and calls CleverTap's **server-side Events API** (`POST /1/upload`) directly | Shopify-format passthrough only makes sense if Ratio delivers to a CleverTap endpoint CleverTap has built. Here the app *is* the integration, so it maps to CleverTap's documented event schema — which needs no cooperation from CleverTap's team and no "add Ratio as a platform" partnership (the source PRD's highest-likelihood risk, marked H). |
| **D4** | Requires a **KwikPass JS code change** (a new `onUserLogin` call after OTP) — owned by an external GoKwik team, listed as an open question and an M-likelihood risk | No KwikPass change. The pixel reads identity from the signals KwikPass **already emits**: `window.__openstore_user`, the origin-gated GoKwik `postMessage` (`otpVerifiedGk` / `kp_token`), and the `user-loggedin` / `user_loggedin_merchant` window events — with `metadata.user_data` as a supplementary source | The conclusion (no external dependency) holds, but **the original rationale in this row was wrong and is corrected here.** It claimed identity rides on `metadata.user_data` from OpenStore bus events. It does not: `meta-pixel.ts` states twice, from live experience, that **"KwikPass auth is NOT published on the OpenStore bus"** — so at the OTP moment no bus event fires and a `metadata.user_data`-only bridge identifies nobody, silently destroying the identity moat this PRD is built on. `meta-pixel.ts` is the proven reference and the pixel now mirrors it. The origin allowlist `/(^|\.)gokwik\.(co\|com\|in\|io)$/i` is a **security control** — identity PII is never accepted from another origin (tested against 7 spoofing variants). ⚠️ `moengage-pixel.ts` still has the original defect. |
| **D5** | "All monetary amounts: decimal rupees (e.g. `999.00`)" | ⚠️ **DEVIATION WITHDRAWN 2026-07-29 — the source PRD was RIGHT for orders.** The app no longer converts order money; it parses the rupee value as-is. | The paise finding was real but generalised from the wrong resource: it was verified against live `products/update` deliveries (`learnings.md` 2026-06-22), and `products/*` IS integer paise. The official webhook docs (https://sandbox-developers.dev.gokwik.in/docs/webhooks/topics) state ORDER money is **rupees**, shipped as decimal strings (`"1200.00"`). So both units are real — orders = rupees, products = paise — and dividing on the order path under-reported CleverTap revenue 100× (₹1,200 → ₹12) until 2026-07-29. |
| **D6** | CleverTap pulls the catalog from `GET /app/products` for dynamic product recommendations | Out of scope for v1 | No `/app/products` app-facing catalog endpoint exists; the platform's product read surface is `GET /products` with its own camelCase shape. Deferred rather than invented. |
| **D7** | `X-Ratio-Webhook-ID` idempotency header and Ratio-side 3× retry with 60s/5m/30m backoff | Inbound: core dedupes via `webhook_log`. Outbound: **this app** makes its own forwarding to CleverTap idempotent, keyed on the order id. | The header names differ in reality — the signature header is `x-openstore-signature: sha256=<hex>`, and the platform's own subscription API takes a per-subscription `secretKey` plus optional `customHeaders`. The envelope has **no top-level delivery id or timestamp**, so an idempotency key must be derived (`<event_type>:<order_id>`), which is what core already does. |

**R1 — RESOLVED 2026-07-25.** Queried the live registry
(`GET /api/v1/admin/webhook-setup/event-types`, HTTP 200, 18 event types) rather
than inferring from this repo. Outcome: `orders/paid`, `orders/fulfilled`, and
`orders/partially_fulfilled` **exist** and are now in v1 scope; `customers/*`,
`checkouts/*`, `fulfillments/*`, and `draft_orders/*` **do not exist** and are
tracked in `TODO.md`. A self-serve `POST /api/v1/app-webhooks` subscription API
also exists, so the source PRD's subscription model is real — it simply lives on
the platform, not in this repo. **Still to confirm at TRD time:** that each
subscribed topic's delivered `event_type` string matches the constant in
`topics.ts` exactly (a mismatch makes the dispatcher silently skip the handler)
and the real `orders/paid` payload shape, since only `products/*` payloads have
been verified live so far.

## Out of scope

- **ScriptTag automatic injection** (D1) — pasted script tag in v1; adopt the
  ScriptTag API if/when it ships.
- **`customers/*`, `checkouts/*`, `fulfillments/*`, `draft_orders/*`, refund
  topics** (D2) — verified absent from the live platform registry. Consequently
  **no server-side checkout-abandonment event** in v1. All nine are tracked with
  owners and workarounds in `TODO.md`; none is a code task in this build.
- **`orders/edited`, `orders/delete`, `products/*`, `collections/*`, `reviews/*`,
  `loyalty/points_*`** — available on the platform but not wired in v1. Listed in
  `TODO.md` as v1.1 candidates.
- **Shopify-format payload passthrough** (D3) and any CleverTap-side
  partnership work ("add Ratio as a platform", CleverTap OAuth) — this app talks
  to CleverTap's public Events API.
- **Catalog sync to CleverTap** (D6) — no product recommendations in campaigns
  for v1.
- **Mobile (iOS/Android) CleverTap SDK** — Ratio storefronts are web only.
- **CleverTap Web Push / service-worker hosting** — MoEngage needs a merchant
  self-hosted service worker; CleverTap web push is deferred to v1.1 for the
  same reason (the merchant must host a file at their domain root).
- **CleverTap dashboard, Journeys, campaign builder, billing, opt-out
  enforcement, WABA/template approvals** — CleverTap SaaS concerns.
- **Deduplicating CleverTap against KwikEngage/MoEngage campaigns** — a merchant
  configuration responsibility; at most a warning in the admin.
- **Hybrid Shopify+Ratio duplicate-event suppression** (`source: "ratio"` gating)
  — belongs to the platform's order service, not this app.
