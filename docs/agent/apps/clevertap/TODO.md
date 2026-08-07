# CleverTap — TODO / platform asks

Tracked gaps for the CleverTap app. **Nothing here is a code task in the v1
build** — these are either platform asks (the Ratio/GoKwik platform team must
build the topic before this app can subscribe) or deliberate v1.1 deferrals.

Grounded on the live platform, **2026-07-25**. **There are two registries and they
disagree** — checking only one produced a wrong scope twice, so always check both:

| Endpoint | Meaning | Result |
|---|---|---|
| `.../admin/webhook-setup/event-definitions` | **Master catalog.** What the merchant-facing dashboard shows. | **21** events / 6 categories: orders 8, products 3, collections 3, **customers 3**, reviews 2, loyalty 2 |
| `.../admin/webhook-setup/event-types` | **Synced registry.** Deliverable in UAT today. | **18** — the catalog minus all 3 `customers/*` |
| `.../admin/webhook-setup/status` | Drift check | `eventTypeCount: 18`, `expectedEventCount: 21`, `processorHealthy: true` |

Re-run all three before starting the TRD — anything that lands upstream moves
straight into scope.

---

## 1a. Needs a SYNC **and** one core change — `customers/*`

`customers/create`, `customers/update`, and `customers/delete` are **fully defined
in the master catalog** with their own pipeline
(`topic: sandbox.os.ecosystem.customer.events`, `groupId: webhook.customers`).
They are simply absent from UAT's synced registry — that's the whole 18-vs-21
drift.

**There are TWO required preconditions and BOTH are needed** — the sync alone is not
enough (discovered during implementation):

- **Precondition 1 — registry setup re-run (ops). NOT `sync`.** An earlier draft of
  this doc said `POST /admin/webhook-setup/sync` closes the gap. **It does not** —
  read the endpoint directions:
  - `sync` — *"**Fetches** all event types **from** webhook-delivery-processor and
    updates local database."* It pulls **processor → local**. If `customers/*`
    does not exist in the processor, sync has nothing to pull and the count stays
    18. Sync cannot create what isn't there.
  - `run` — *"**Creates** consumer configs, categories, and event types **in**
    webhook-delivery-processor. Stores all IDs in local database. **Only run
    once**"*, with `?force=true` to re-run. This is the **only** endpoint that
    creates processor-side event types.
  - `POST /admin/webhook-categories` — upserts into the **local DB only**
    ("additive only"). Rows created that way carry no `processorEventTypeId`, so
    they are **inert** — the same `hasSecretKey: false` pattern seen on the 48
    non-registry rows. It would fake support without delivery.

  So the real action is **`POST /admin/webhook-setup/run?force=true`** — and it is
  **not** a casual ops task. ⚠️ It re-creates consumer configs, categories and
  event types in the processor; if the processor issues **new** ids, every existing
  subscription's `processorEventTypeId` linkage may be invalidated, putting all
  **179 live subscriptions across 13 apps** at risk. That blast radius is far
  beyond CleverTap. Treat it as change-managed, owned by the os-ecosystem team,
  with a post-run check that the existing 18 topics still deliver.

  **Why the drift exists (inference).** `event-definitions` is a *predefined list
  in the service's code*, not state. `isSetup: true` means `run` already executed —
  when the deployed code knew only 18 events. `customers` was almost certainly
  added to the predefined list in a later deploy and setup was never re-run. Hence
  `eventTypeCount: 18` vs `expectedEventCount: 21`.

  **When does it run? Never automatically.** No cron, no scheduler, no trigger —
  `run` is explicitly a one-time manual admin call, and nobody has committed to
  making it. The 18-vs-21 drift has persisted unchanged since at least 2026-07-25.

  ⚠️ **`processorHealthy` FLAPS — do not read it as a steady state.** On
  2026-07-29 it returned `false` once, then `true` on three consecutive checks
  minutes later (it was `true` on 2026-07-25). So the processor is not down, but
  it is **intermittently** unhealthy. Practical consequence: a missing delivery is
  not automatically an app bug — check `GET /admin/webhook-setup/status` **at the
  moment of the failure**, and re-check, before debugging app code. Worth
  mentioning to the os-ecosystem team as a stability question, since intermittent
  processor health would produce exactly the kind of unreproducible
  "sometimes events don't arrive" reports that are impossible to diagnose from the
  app side.
- **Precondition 2 — a `core/` change (feature-tier).**
  `apps/backend/src/core/webhooks/webhooks.types.ts#envelopeResource` returns
  `(e.product ?? e.order ?? {})` — there is **no `customer` branch**, so a customer
  delivery reaches `handle()` as `{}`. Both CleverTap customer handlers degrade to
  warn + no-op (tested), so nothing breaks — but nothing propagates either. Adding
  the `customer` branch touches `core/` and is therefore feature-tier work,
  deliberately **not** made from inside this module. Tracked as TRD §8 **R9**.

  Until **both** land, `customers/*` cannot work: the sync makes deliveries arrive,
  the core change makes them carry a payload.
- **Impact until both land:** `customers/create` + `customers/update` are in v1
  scope and their handlers get built, but stay inert. The one
  thing with no workaround is **marketing-consent propagation**
  (`email_marketing_consent` / `sms_marketing_consent`) — CleverTap enforces
  opt-out from its own profile data, so until these deliver, a customer who opts
  out in Ratio can keep receiving CleverTap messages. Flag this to merchants.
- **Partial workaround for the rest:** the pixel identity bridge (`onUserLogin`
  from `metadata.user_data`) creates and refreshes the CleverTap profile on each
  identified storefront event. Misses only customers created via admin/import who
  never have a storefront session.

## 1b. Platform asks — topics that do NOT exist at all

Seven of the source PRD's topics appear **nowhere** in the 21-event catalog
(verified: zero occurrences of `checkouts`, `fulfillments`, `draft_order`). These
need real platform development. Owner: **Ratio platform / os-ecosystem team**.

| # | Topic | Source PRD priority | What CleverTap loses | Workaround in v1 |
|---|---|---|---|---|
| 1 | `checkouts/create` | P0 | **The abandonment clock** — the trigger that starts CleverTap's abandoned-cart Journey, the source PRD's single headline use case. **Highest-value ask by a wide margin.** | Pixel fires client-side `InitiateCheckout`. Works, but browser-dependent (lost to ad blockers / closed tabs) and carries no server-authoritative cart state. |
| 2 | `checkouts/update` | P0 | Latest cart + address state for personalising the recovery message ("you left *this* item"). | Pixel `AddToCart` / `InitiateCheckout` properties only; cart may be stale at send time. |
| 3 | `checkouts/delete` | P1 | Cleanup signal — lets CleverTap cancel a queued Journey when the checkout session is gone. | None. A Journey may fire for a checkout that no longer exists. |
| 4 | `fulfillments/create` | P1 | Per-fulfilment records (multi-shipment orders), tracking numbers. | `orders/fulfilled` + `orders/partially_fulfilled` **do exist** and are in v1 scope, so order-level fulfilment is covered; per-shipment granularity is not. |
| 5 | `fulfillments/update` | P1 | Tracking-number / shipment-status changes → "your order shipped / out for delivery" Journeys. | Same — order-level only. |
| 6 | `draft_orders/create` | P1 | Draft-order recovery flows. | None. Out of scope for v1. |
| 7 | `draft_orders/update` | P1 | Same. | None. Out of scope for v1. |

**Also absent:** any refund topic (the source PRD already defers this behind the
Refund Module, so it is not a regression).

Raise 1–3 (`checkouts/*`) first: they are what make the source PRD's KwikPass
identity advantage monetisable, since identifying an abandoner only pays off if
you also know they abandoned.

### How to raise these

The repo convention for platform requests is a `<Vendor> - Platform Asks.md`
doc in `update/` (see `Delhivery - Platform Asks.md`,
`Delhivery Direct - Platform Asks.md`, `Core Team — Native Fields Request.md`).
Rows 1–3 (`checkouts/*`) are the highest-value ask by a wide margin: they are
what make the source PRD's KwikPass-identity advantage actually monetisable, since
identifying an abandoner is only useful if you also know they abandoned.

---

## 2. Available on the platform, deliberately not wired in v1

These topics exist and could be subscribed today. Listed so a future build does
not re-derive them.

| Topic | Candidate CleverTap use | Notes |
|---|---|---|
| `loyalty/points_credited` | "You earned N coins" push; loyalty-tier Journeys | Directly serves the source PRD's "loyalty tier update notification" use case. Pairs with the in-repo `loyalty` app. |
| `loyalty/points_debited` | Redemption confirmation | Same. |
| `reviews/create` | Thank-you / UGC-amplification Journey | Complements the source PRD's "3-day review request" post-purchase flow — closes the loop by detecting whether the review actually arrived. |
| `reviews/update` | Moderation-driven suppression | Low value for campaigns. |
| `customers/delete` | GDPR / data-deletion propagation | Defined in the catalog (pending the same sync as the other `customers/*`). The natural home for the customer-deletion flow the source PRD defers as "GDPR data deletion webhook spec TBD". |
| `orders/edited` | Order-change notification | Source PRD marks order edits as "no CleverTap trigger" (N/A), so intentionally skipped. |
| `orders/delete` | — | Source PRD marks as N/A. |
| `products/create` · `products/update` · `products/delete` | **CleverTap catalog sync — BUILT** | No longer a deferral: `products/*` now feed a debounced dirty-scheduler that full-replaces the CleverTap catalog via the 3-step CSV API. Go-live is gated on `CLEVERTAP_CATALOG_CONTRACT_VERIFIED` (see §4). |
| `collections/create` · `collections/update` · `collections/delete` | Category-level segmentation | Low priority. |

---

## 3. Non-topic gaps carried from the source PRD

| Item | Status | Note |
|---|---|---|
| **ScriptTag / automatic script injection** | Not in this repo | v1 uses a pasted `<script>` (D1), as every shipped pixel vendor here does. **But** the live spec shows the platform now has app-extension machinery — `extensionType: web_pixel` / `app_embed` and targets `storefront.global.embed.render`, `storefront.web_pixel.sandbox`. Worth investigating as the real injection path before assuming pasted-script is permanent. |
| **`GET /app/products` catalog endpoint** | Resolved (uses `GET /api/v1/v1/products`) | The catalog-sync product source is **verified** at `GET /api/v1/v1/products?limit&page` on `RATIO_API_BASE_URL`, auth = merchant OAuth bearer (`READ_PRODUCTS` scope), Shopify-shaped response `{ products[], pagination{ hasNext } }`. Still note the REST vs webhook shape split: REST is camelCase, webhooks snake_case — separate normalisers needed (`learnings.md`, 2026-06-18). |
| **CleverTap-side "add Ratio as a platform"** | Not needed | Removed as a dependency by D3 — this app calls CleverTap's public Events API, so no CleverTap engineering or partnership work gates the build. This deletes the source PRD's highest-likelihood (H) risk. |
| **KwikPass `onUserLogin` code change** | Not needed | Removed by D4 — identity comes from `metadata.user_data` already on OpenStore pixel events. Deletes an external-team dependency and open question. |
| **CleverTap Web Push** | Deferred to v1.1 | Requires the merchant to self-host a service worker at their domain root, same constraint as MoEngage's `swPath`. |
| **Duplicate messaging vs KwikEngage / MoEngage** | Won't fix | Merchant configures suppression in each platform. At most an admin warning banner when multiple engagement apps are installed. |

---

## 4. Verification still owed (carried into the TRD)

- [ ] **Catalog go-live: flip `CLEVERTAP_CATALOG_CONTRACT_VERIFIED`** after a live
      catalog upload verification (real `catalogName` + admin email). The 3-step
      CSV full-replace API (`get_catalog_url` → PUT CSV → `upload_catalog_completed`,
      auth `X-CleverTap-Account-Id` + Passcode, mandatory CSV cols
      `Name`/`ImageURL`/`Category`, no per-item endpoint) and the product source
      (`GET /api/v1/v1/products`) are both wired; only the live upload confirmation
      remains before enabling sync for merchants.
- [ ] Confirm the delivered `event_type` string for each subscribed topic matches
      the `topics.ts` constant **exactly** — a mismatch makes the core dispatcher
      silently skip the handler (the topic-mismatch fast path). Only `products/*`
      has been confirmed against a real delivery so far.
- [ ] Capture a real `orders/paid` payload and confirm the field shape, the
      customer snapshot, and that line-item prices are integer **paise**
      (`learnings.md` 2026-06-22 — verified for products, assumed for orders).
- [ ] Confirm how this app registers subscriptions: `POST /api/v1/app-webhooks`
      (`{ eventName, webhookUrl, secretKey?, customHeaders? }`) vs. the
      admin `webhook-setup/sync` path other modules rely on, and which auth the
      app presents.
- [ ] Confirm `app/uninstalled` is delivered — it is **not** in the 18-item
      event-type registry, yet every module in this repo handles it, so it is
      presumably an app-lifecycle webhook registered separately from the
      merchant-data event registry.
- [x] **RESOLVED (2026-07-25) — TRD R5: CleverTap Web SDK URL + region init.**
      Verified against CleverTap's Web SDK Quick Start and the
      `CleverTap/clevertap-web-sdk` + `clevertap-web-sdk-shopify` READMEs. CDN is
      `https://d2r1yp2w7bby2u.cloudfront.net/js/clevertap.min.js`, isolated in a
      single `CLEVERTAP_SDK_URL` constant in the pixel and asserted in its test.
      Region is published **two** ways because the vendor documents both —
      `clevertap.account.push({id}, region)` **and** `clevertap.region = region`;
      both are idempotent and both are asserted.
      ⚠️ **Caveat:** the SDK README lists regions `in1, us1, sg1, aps3, mec1` — it
      does **not** list `eu1`, which **is** in our `CLEVERTAP_REGIONS`. The pixel
      passes `region` through unvalidated, so an `eu1` merchant may get a
      browser-side region fallback. Tracked as TRD §8 **R12**.
