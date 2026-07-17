# TDD — Delhivery Direct (`delhivery`)

> Test Plan / Test-Driven Design, from the approved PRD + TRD. Builders write these
> tests **first (failing)**, then implement to green. Human-approved at **GATE 3**.

**Source PRD/TRD:** `docs/agent/apps/delhivery/PRD.md`, `TRD.md`
**Status:** draft

## 1. Test strategy

- **Runner:** `vitest`. Backend unit/integration under `apps/backend/test/unit/**`; admin tests under `apps/admin-delhivery/src/**`.
- **Unit:** services + mappers + Zod schema in isolation. **Mock** the Delhivery SDK (`SdkService`), the Ratio Orders API client, and the DB (Kysely) — mirror how `modules/google` tests mock the vendor SDK + platform.
- **Integration:** controllers + webhook handlers against a mocked SDK + in-memory/mocked Kysely; assert DB writes + order-mirror calls.
- **Frontend:** Vitest + Testing Library for the Config form + Shipments screen with a mocked API layer.
- **Out of scope:** heavy e2e/live-Delhivery QA (needs real staging creds — done manually pre-launch, not in this suite).

## 2. Acceptance criteria → test mapping

| PRD acceptance criterion | Test case(s) |
|---|---|
| Config saved; `api_token` encrypted; test-connection validates | `config.save.encryptsToken`, `config.test.ok`, `config.test.invalid401` |
| Warehouse registered on save | `config.save.registersWarehouse` |
| `orders/paid` (auto) → AWB <30s; shipment row; mirror to order | `worker.paid.createsAwb`, `worker.paid.persistsShipment`, `worker.paid.mirrorsToOrder` |
| Manual mode → no auto-AWB; create from Shipments | `worker.paid.manualModeSkips`, `shipments.manualCreate` |
| Label PDF printable (proxy) | `label.proxyStreamsPdf`, `label.credsServerSide` |
| Pickup at cutoff; manual pickup | `pickup.cronSchedulesPending`, `pickup.manualRequest` |
| Tracking poll → status synced; events fired; deduped | `tracking.mapStatus.*`, `tracking.firesKwikEngageEvent`, `tracking.dedupePerTransition` |
| NDR read-only + link; RTO → restock + refund | `tracking.ndrStatusOnly`, `tracking.rtoRestocks`, `tracking.rtoRefundPrepaid` |
| Serviceability returns fields + 6h cache | `serviceability.returnsFields`, `serviceability.cacheHit`, `serviceability.failOpen` |
| SDK loader route serves prelude + bundle; inactive → 404 | `storefront.servesLoaderWithPrelude`, `storefront.inactiveMerchant404`, `storefront.servesWidgetBundle` |
| Headless client wraps the public endpoint; PIN guard | `client.buildsUrl`, `client.rejectsBadPincode`, `loader.exposesHeadlessClient` |
| Optional widget renders verdict + emits event, lazily injected | `widget.rendersResult`, `widget.emitsServiceabilityEvent`, `loader.lazyInjectsWidget`, `loader.noInjectWithoutElement` |
| COD-vs-Prepaid mapped | `payment.mapsCod`, `payment.mapsPrepaid` |
| `app/uninstalled` flips inactive | `webhook.uninstalledFlipsInactive` |
| `pnpm verify` passes | CI gate (§7) |

## 3. Backend test cases

- **ConfigService/Controller:** `config.save.encryptsToken` (token stored encrypted, never plaintext); `config.test.ok` / `config.test.invalid401` (Delhivery auth check mocked ok/401); `config.save.registersWarehouse` (calls Warehouse Creation, stores pickup-location name).
- **ShipmentCreateWorker (orders/paid):** `worker.paid.guardSource` (non-Ratio-origin → skip); `worker.paid.idempotent` (duplicate `order_number` → no 2nd AWB); `worker.paid.buildsPackage` (hs_code + product dim metafields → L/B/H; default-box fallback; grams→kg); `worker.paid.createsAwb` (Manifestation mock → waybill); `worker.paid.persistsShipment`; `worker.paid.mirrorsToOrder` (PATCH order fulfillment_status + tracking + external_id); `worker.paid.retriesOn5xx`; `worker.paid.manualModeSkips`.
- **TrackingReconcileCron/TrackingService:** `tracking.mapStatus.manifested|inTransit|ofd|delivered|ud|rt|cn` (StatusType→Ratio status table); `tracking.dedupePerTransition` (one event per StatusType change); `tracking.firesKwikEngageEvent` (app-side event on transition); `tracking.ndrStatusOnly` (UD→delivery_failed, no resolution action); `tracking.rtoRestocks` (RT→Inventory increment_stock); `tracking.rtoRefundPrepaid` (prepaid→refund; COD→none).
- **ServiceabilityService/Controller:** `serviceability.returnsFields` (serviceable/edd/cod from mock); `serviceability.cacheHit` (2nd call within 6h → no Delhivery call); `serviceability.failOpen` (Delhivery down → serviceable=true generic EDD).
- **Label proxy:** `label.proxyStreamsPdf`; `label.credsServerSide` (token not exposed to client).
- **PickupCron:** `pickup.cronSchedulesPending` (gathers `awaiting_pickup`, calls manifest); `pickup.manualRequest`.
- **Webhook controller:** `webhook.uninstalledFlipsInactive`; `webhook.badHmacRejected`; `webhook.cancelledCancelsAwb`.
- **Payment mapping:** `payment.mapsCod`, `payment.mapsPrepaid`.
- **Migration 0001:** `migration.createsTables` (configs/shipments/tracking_events + indexes + unique `order_number`, unique `(awb, unified_status)`).

## 4. Frontend test cases

- **Config screen:** `form.validatesRequired` (token, warehouse, gstin); `form.cutoffFormat`; `form.awbTriggerToggle`; `form.testConnectionStates` (idle/loading/ok/error); `form.saveBindsApi`.
- **Shipments screen:** `list.rendersStatuses`; `list.printLabelButton`; `list.ndrReadOnlyWithManageLink`; `list.apiBinding` (loading/empty/error states).

## 4b. Storefront SDK test cases (`packages/delhivery-sdk`, Vitest + happy-dom)

- **Client (`src/client.test.ts`):** `client.buildsUrl` (GET `{apiBase}/delhivery/api/serviceability?merchantId=&pincode=`); `client.forwardsOrderValueCod` (`order_value`/`cod` appended only when given); `client.trimsApiBase`; `client.rejectsBadPincode` (non-`[1-9][0-9]{5}` → `DelhiveryClientError` status 400, **no network call**); `client.trimsPincode`; `client.mapsResponse`; `client.unwrapsEnvelope` (tolerates the backend `{ data }` ResponseInterceptor envelope); `client.throwsOnHttpError` (non-2xx → error with status); `client.abortsInflight` (new check aborts the previous).
- **Loader (`src/loader.test.ts`):** `loader.readsMerchantFromPrelude` (backend-injected `window.__DELHIVERY__`); `loader.readsMerchantFromSrcPath` (`/delhivery/sdk/<id>.js`); `loader.readsMerchantFromQuery` (`?store=`); `loader.noMerchantNoBoot`; `loader.exposesHeadlessClient` (`window.RatioDelhivery.checkServiceability` hits the public endpoint); `loader.noInjectWithoutElement`; `loader.lazyInjectsWidget` (widget ESM injected only when `<delhivery-serviceability>` is present); `loader.loadWidgetOnDemand` (idempotent `loadWidget()`); `loader.idempotentBoot`.
- **Widget (`src/ui/serviceability-widget.test.ts`):** `widget.rendersInput` (numeric PIN input + button); `widget.rendersResult` (EDD band + "COD available" badge); `widget.prepaidOnlyBadge`; `widget.rendersNotServiceable`; `widget.emitsServiceabilityEvent` (composed/bubbling `CustomEvent<{pincode, result}>` observable at `document`); `widget.invalidPinError` (no client call); `widget.failureIsSoft` (API failure → retry message, no crash); `widget.enterKeySubmits`.
- **Theme/version:** `themeVars` emits `--dlv-*` tokens with defaults; `SDK_VERSION` is semver.
- **Backend loader-serving route (`apps/backend/test/unit/apps/delhivery/storefront.controller.test.ts`):** `storefront.servesLoaderWithPrelude` (prelude `window.__DELHIVERY__ = {merchantId, version}` + bundle, JS content-type, CORS `*`, `max-age=300` on success only); `storefront.inactiveMerchant404` (`MERCHANT_INACTIVE`); `storefront.servesWidgetBundle` (`max-age=3600`); `storefront.missingBundle404` (unbuilt SDK → clear 404); `storefront.preludeIsXssSafe` (`safeInlineJson` escaping).
- **Gates:** `cd packages/delhivery-sdk && pnpm typecheck && pnpm test && pnpm build && pnpm size` — `size-limit` budgets: loader ≤ 3 KB, widget ≤ 10 KB (no results bundle).

## 5. Shared-schema test cases (`delhivery-config` Zod)

- `schema.acceptsValid`; `schema.rejectsMissingToken`; `schema.rejectsBadCutoff` (non-HH:mm); `schema.rejectsInvalidAwbTrigger`; `schema.rejectsNegativeBoxDims`.

## 6. Fixtures & helpers

- `merchantFixture` (active/inactive); `configFixture` (valid + encrypted-token variant).
- `paidOrderFixture` — Ratio-origin + Shopify-origin variants; COD + Prepaid variants.
- `productFixture` — with `hs_code` + dimension metafields + weight; and one missing dims (→ default box).
- **Delhivery API mocks:** serviceability, Manifestation→waybill, tracking scans (`UD`/`DL`/`RT`/`In Transit`/`OFD`), label PDF, warehouse-creation, 401, 5xx, 429.
- Inventory + Orders-API + KwikEngage-event client mocks.

## 7. Definition of done

- [ ] `pnpm verify` green (lint → typecheck → test → build).
- [ ] Every §2 acceptance criterion has ≥1 passing test (no orphans).
