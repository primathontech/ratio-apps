# PRD — Delhivery Direct

> Structured for the `build-app` pipeline. Derived from the India Shipping Aggregator
> program specs (PRD/TRD/Flow/Platform-Asks) + verified against the live platform API.
> **Thin integration, direct model — no Ratio Fulfillment Service.**

## Vendor name & slug

- **Display name:** Delhivery Direct
- **Slug:** `delhivery`
- **Storefront SDK?** `yes` — **serviceability at checkout ships as a storefront SDK** (`packages/delhivery-sdk`, `hasStorefrontSdk: true`; scope change confirmed with the platform team 2026-07-03). It is NOT a search/browsing widget: a headless client (`window.RatioDelhivery.checkServiceability`) is the primary integration for Kwik Checkout, plus an optional `<delhivery-serviceability>` element. See "Storefront SDK" below.

## Problem

Ratio merchants shipping via Delhivery have **no native integration**: their ops teams manually create shipments in Delhivery's dashboard, copy AWBs, print labels there, and reconcile tracking by hand — 30–60 min/day, worse at 300–2000 orders/day. Enterprise brands already hold **direct Delhivery contracts** and expect logistics to "just work" inside Ratio like it did on Shopify.

This app is a **thin integration layer**: auto-generate the AWB when an order is paid, print the label in Admin, sync tracking, and check pincode serviceability at checkout. **Logistics *management* — NDR resolution, COD remittance, claims — stays in the Delhivery dashboard the merchant already uses; Ratio only reflects status and collects minimal input.**

Users: merchant ops teams (daily fulfillment). Uses the merchant's own Delhivery **Express B2C** API (`Authorization: Token`).

## Data model (tables / fields)

Beyond the standard `merchants`, `oauth_tokens`, `webhook_log` (present in every module):

| Table | Column | Type | Notes |
|---|---|---|---|
| `delhivery_configs` | `merchant_id` | varchar(128) PK | FK → `merchants.id` |
| | `api_token` | text | 🔒 **encrypted at rest** — Delhivery Express B2C token |
| | `pickup_location_name` | varchar(255) | Delhivery-registered warehouse (acts as warehouse id + RTO dest) |
| | `gstin` | varchar(20) | Seller GSTIN → Delhivery `seller_gst_tin` |
| | `pickup_cutoff` | time | daily manifest cutoff (default `10:00` IST) |
| | `awb_trigger` | enum(`auto`,`manual`) | default `auto` (create on `orders/paid`) |
| | `default_box_l/b/h_cm` | int | fallback package dims when product dims absent |
| | `enabled` | boolean | per-merchant kill switch |
| `delhivery_shipments` | `id` | varchar(128) PK | shipment record (**module-owned — the source of truth; no Fulfillment Service**) |
| | `merchant_id` | varchar(128) | FK |
| | `order_id` / `order_number` | varchar(128) | Ratio order; `order_number` = Delhivery `order` (idempotency) |
| | `awb` | varchar(64) | Delhivery waybill |
| | `carrier` | varchar(32) | `DELHIVERY` |
| | `status` | varchar(32) | awaiting_pickup / in_transit / out_for_delivery / delivered / delivery_failed / rto_completed / shipment_cancelled |
| | `payment_mode` | enum(`COD`,`Prepaid`) | mapped from order payment |
| | `cod_amount` / `weight_grams` | int | |
| | `label_url` / `estimated_delivery` | varchar / date | |
| | `active` | boolean | latest non-cancelled = active (append-only history) |
| | `created_at` | datetime | |
| `delhivery_tracking_events` | `id` | varchar(128) PK | tracking audit + dedupe |
| | `awb` | varchar(64) | FK → shipment |
| | `raw_status` / `unified_status` | varchar(32) | Delhivery StatusType → Ratio status |
| | `location` / `event_ts` | varchar / datetime | |

> The AWB/tracking **source of truth is this module's DB** (`delhivery_shipments`). A **summary is mirrored to the platform order** (`fulfillment_status` + `tracking_number`/`carrier` — native field preferred, order `metafields` interim) for the Admin order view + notifications.

## Scopes / permissions

- `read_orders` — read the paid order (address, line items, payment, weight) to build the shipment.
- `write_orders` — write `fulfillment_status` + AWB/tracking (native field or `metafields`) + `external_order_id` back to the order.
- `read_products` — read `hs_code` + dimension metafields + weight per product to build the Delhivery package.

## Webhook events

- `app/uninstalled` — flip merchant inactive (default).
- **`orders/paid`** — **ship trigger.** Guard `order.source` == Ratio storefront (confirm exact value — dashboard showed `"Online Store"`); dedupe by `order_number`; if `awb_trigger=auto`, enqueue AWB creation (SQS worker).
- `orders/cancelled` — cancel the AWB (pre-pickup) or mark; set `shipment_cancelled`.
- `orders/edited` — address/COD change pre-pickup → cancel + recreate AWB.

*(No `order.confirmed` event exists; `orders/paid` is the verified paid/ship signal.)*

## Admin screens

- **Config** — API token (+ **Test connection**), warehouse/pickup registration, GSTIN, pickup cutoff (default 10:00), **AWB trigger (auto/manual)**, default box size, enable toggle. *(Embedded Merchant-App page, mirroring `admin-google` `config.tsx`.)*
- **Shipments** (dashboard) — list orders with AWB, carrier, status, **Print Label**, tracking timeline; **NDR shown read-only** + a **"Manage in Delhivery"** link. *(Mirrors `admin-google` `feed.tsx`.)*
- *(Per-order AWB/tracking/label may also render on the platform order-detail via an `admin.order-details.block` extension, if used.)*

## Storefront SDK (serviceability at checkout)

**`packages/delhivery-sdk`** — a serviceability-at-checkout SDK (a REDESIGN of the search-oriented `_template`/`wizzy` SDK: no results page, no recent-searches, no anon id). Loaded via **one per-merchant script tag** served by the backend:

```html
<script src="https://<backend>/delhivery/sdk/<merchantId>.js" defer></script>
```

- **Loader** (IIFE, ≤ 3 KB) — the backend prepends a `window.__DELHIVERY__ = { merchantId, version }` prelude (public values only); the loader derives the API base from its own script origin and installs the headless client.
- **Headless client (PRIMARY — Kwik Checkout):** `window.RatioDelhivery.checkServiceability(pincode, { orderValue?, cod? })` → `{ serviceable, cod_available, edd_min, edd_max, carrier }`, wrapping the PUBLIC `GET /delhivery/api/serviceability` endpoint (no auth; CORS `*`; 6h cache; fail-open). 6-digit PIN validated client-side; in-flight checks aborted on re-entry.
- **Optional widget** (Lit 3 ESM, ≤ 10 KB) — `<delhivery-serviceability>` renders a PIN input + verdict (EDD band, COD badge) in Shadow DOM and emits a composed `serviceability` CustomEvent; the loader injects the widget bundle **lazily, only when the element is used**.
- **No secrets in any bundle** — the merchant's Delhivery token stays server-side; only the merchant id + backend origin reach the browser.

## Acceptance criteria

- [ ] Merchant saves Delhivery config; `api_token` stored **encrypted**; **Test connection** validates against Delhivery.
- [ ] Warehouse registered with Delhivery on save (pickup-location name stored).
- [ ] `orders/paid` (Ratio-origin, `awb_trigger=auto`) → AWB created within ~30s; `delhivery_shipments` row written; AWB + `fulfillment_status` **mirrored to the order**.
- [ ] `awb_trigger=manual` → no auto-AWB; merchant creates from the Shipments screen.
- [ ] Label PDF printable from Admin (backend proxy; creds stay server-side).
- [ ] Pickup scheduled at the configured cutoff (default 10:00 IST) via the manifest API; manual "Request Pickup" works.
- [ ] Tracking **polled** → order status synced (in_transit / out_for_delivery / delivered / delivery_failed / rto_completed); shipping events **fired app-side** → KwikEngage; **deduped** per StatusType transition.
- [ ] NDR surfaced read-only + "Manage in Delhivery"; **RTO** → Inventory `increment_stock` + refund trigger (prepaid); COD → no refund.
- [ ] Serviceability endpoint returns `serviceable`/`edd`/`cod_available` for a pincode with a **6h cache**; consumable by GoKwik Checkout.
- [ ] Backend serves the per-merchant SDK loader at `GET /delhivery/sdk/<merchantId>.js` (prelude + built loader; 404 `MERCHANT_INACTIVE` for uninstalled merchants) and the widget bundle at `GET /delhivery/sdk/delhivery-widget.js` — both public, CORS `*`.
- [ ] Loading the loader script exposes `window.RatioDelhivery.checkServiceability(pincode, {orderValue?, cod?})` → the serviceability verdict; malformed (non-6-digit) PINs are rejected client-side without a network call.
- [ ] The optional `<delhivery-serviceability>` element renders the verdict (EDD band + COD badge) and emits a composed `serviceability` CustomEvent; its bundle is injected only when the element is used.
- [ ] No secret (Delhivery token, client secret) appears in any SDK bundle or SDK response; size budgets hold (loader ≤ 3 KB, widget ≤ 10 KB via `size-limit`).
- [ ] COD-vs-Prepaid mapped correctly onto the shipment (`payment_mode`).
- [ ] `app/uninstalled` flips the merchant inactive.
- [ ] `pnpm -r lint && pnpm -r typecheck && pnpm -r build` pass (`pnpm verify`).

## Out of scope

- **NDR resolution actions** (re-attempt, address/phone update, initiate RTO) — Delhivery dashboard.
- **COD remittance / reconciliation** — Delhivery dashboard (no carrier API).
- **Claims** (lost/damaged) — Delhivery dashboard.
- **Push-webhook tracking** — v1 is **poll-first**; push = v1.1 (per-account email onboarding to `lastmile-integration@delhivery.com`, ~5–6 days).
- **Multi-warehouse routing**, partial / multi-location fulfillment — v2.
- **Storefront search/browsing widget** — the storefront SDK is serviceability-only (headless client + optional pincode-checker element); no search overlay/results page.
- Other carriers (Shiprocket / Bluedart / Xpressbees) — separate apps.
- **No Ratio Fulfillment Service** — the module's DB is the shipment record; the order is a mirror.

## Open items to confirm (not blockers to spec, resolve during build)

1. **How GoKwik Checkout consumes serviceability** — ✅ **RESOLVED (platform team, 2026-07-03): via the storefront SDK** (see "Storefront SDK" above; TRD §7 item 1). *(Residual assumption to confirm: load mechanism = per-merchant loader `<script>` tag vs a platform checkout-extension bundle.)*
2. **COD-vs-Prepaid field** — which order payment field/value = COD (GoKwik payment contract).
3. **`order.source` value** for Ratio-origin orders (dashboard showed `"Online Store"`, not `"ratio"`) — for the double-shipment guard.
4. **AWB mirror on the order** — native `tracking_number`+`carrier` field (preferred, Backend Core additive) vs order `metafields` (interim).
5. **Delhivery test creds** — staging token + test warehouse via `clientservice@delhivery.com` / account manager.
6. **App approval/scopes** — platform must approve the app so tokens carry `read_orders`/`write_orders` (else 403).
