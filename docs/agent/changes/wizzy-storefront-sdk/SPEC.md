# SPEC — Wizzy storefront search SDK + SDK as an optional architecture pillar

> Status: design approved (brainstorm). Next: `write-plan`.
> Date: 2026-06-25 · Branch: `feat/wizzy` · Scope tier: **feature** (multi-file,
> touches AGENTS.md / scaffolder / `apps.ts`-adjacent wiring → always feature).

## Summary

Build a self-contained, embeddable **storefront search SDK** for the existing
`wizzy` vendor app that reproduces Wizzy's hosted search experience on a Ratio
(or any) storefront: an autocomplete overlay (recent / trending / categories /
suggestions / top products) and a full faceted search-results page (filters,
sort, pagination). The merchant pastes **one `<script>` tag** manually; the SDK
calls Wizzy's **public** search APIs **directly from the browser**.

Second, promote "storefront SDK" to a **first-class but opt-in architecture
pillar** (alongside backend module + admin SPA): a golden `_template-sdk`, a
`hasStorefrontSdk` capability flag, and wiring into AGENTS.md and the
agent-builder skills so future apps that need a storefront widget get it as a
base. The four existing analytics/ads apps (`google`, `meta`, `posthog`,
`moengage`) stay SDK-free.

## Context & key decisions

- **Delivery:** a pasted `<script>` (manual), not the ScriptTag API. ScriptTag
  auto-injection stays `pending_api` (Draft API), unchanged by this work.
- **Result source:** Wizzy's hosted search APIs (real contract, see below) — not
  a Ratio-native search.
- **Transport:** **direct browser → Wizzy.** Wizzy's search/autocomplete are
  **public endpoints** (auth = `x-store-id` + a *public* `x-api-key`; CORS
  wildcard; store secret is explicitly forbidden on public endpoints). So the
  SDK calls `api.wizsearch.in/v1` directly. No backend proxy on the hot path.
- **v1 scope:** overlay **and** full results page **and** facet filters.
- **Attach model:** config-driven **CSS selectors** (works on any storefront).
- **SDK stack (locked):** Lit 3 (Web Components, Shadow DOM) · Vite 6 library
  mode · native `fetch` + `AbortController` · Shadow DOM + CSS custom properties
  · loader = our own ~2KB IIFE stub (NOT external `@ratio-planner/embed-loader`,
  which is a different repo) · size budget **30KB raw / 10KB gz** via `size-limit`
  in CI · banned deps: React/Vue/lodash/moment/axios/jQuery · Vitest + Playwright
  · Biome **2.4.15** (repo version, inherits root `biome.json`) · TypeScript 5.6
  strict.
- **Output formats:** loader = classic **IIFE** (pasteable `<script>`); widget
  bundle = **ESM**. No UMD (YAGNI).
- **Pillar mode:** SDK is **optional / opt-in** via `hasStorefrontSdk`.

## Wizzy API contract (real — from docs.api.wizzy.ai/specs.json, Swagger 2.0)

Base URL `https://api.wizsearch.in/v1` (same host as the existing catalog client).
Public endpoints use `x-store-id` + `x-api-key` only; optional `x-wizzy-userId`
(stable anon id), `x-wizzy-tags`, `x-request-id`.

| Surface | Endpoint | Powers |
|---|---|---|
| Typing overlay | `POST /autocomplete` (`q`, `suggestionsCount`, `productsCount>0`, `minQueryLength`, `currency`, `facets`) → `payload.{categories[],brands[],others[],pages[],products[],banners[]}` | CATEGORIES column, suggestion queries, TOP PRODUCTS |
| Results page | `POST /products/search` (`q`, `productsCount`, `facets`, `sort`, `currency`, …) → `payload.{result[],total,pages,facets[],filterSuggestions,filters,redirectTo}` | results grid + facet definitions |
| Facet filtering | `POST /products/filter` (`filters` = JSON of the **CommonFilter** model: `categories[]`, `brands[]`, `sellingPrice:[{lte,gte}]`, `inStock:[bool]`, `avgRatings`, `attributes{}`, …) | left sidebar filtering |
| Trending | `GET /trendingSearches?size=` → `payload.queries[]` | TRENDING SEARCHES |
| Analytics | `POST /events/{click,view,converted}` | personalization + trending |

Facets requested via `CommonFacetsField` (`key` ∈
`all|categories|brands|sellingPrice|genders|colors|sizes|avgRatings|discountPercentage|inStock|attributes`,
`position: left|right`, optional `buckets`/`config`). Facet response items:
`{label, order, position:left|top, key, type:list|range|dictionary}`.

Product object (shared by `autocomplete.products[]` and `search.result[]`):
`id, name, url, mainImage, hoverImage, brand, sku[], description, inStock,
stockQty, price (MRP), finalPrice, sellingPrice (after discount), discount,
discountPercentage, categories[], colors[], sizes[], attributes[], avgRatings,
totalReviews, gender, groupId`. Prices are rupee floats.

Full extracted contract: `scratchpad/wizzy-search-api-contract.md` (to be copied
into the package as a reference during execution).

## Part A — the Wizzy storefront SDK

### A1. `packages/wizzy-sdk` (`@ratio-app/wizzy-sdk`)
- **Two-stage build outputs:**
  - `wizzy-loader.js` — classic IIFE (~2KB): the pasted tag. Reads
    `?store=<merchantId>`, fetches config, lazy-injects the widget bundle on
    first input focus / `requestIdleCallback`.
  - `wizzy-search.[hash].js` — ESM widget bundle (Lit components).
- **Components:** `<wizzy-search-overlay>` (dropdown), `<wizzy-results-page>`
  (faceted page), internal `wizzy-product-card`, `wizzy-facet-list`,
  `wizzy-facet-range`.
- **Non-UI units:** `WizzyClient` (typed wrapper over the REST contract, native
  fetch + AbortController), `recent-store` (localStorage recent searches),
  `anon-id` (stable `x-wizzy-userId`), `theme` (CSS custom properties).
- All UI mounts inside a **Shadow DOM** root so storefront CSS cannot break the
  widget and widget CSS cannot leak.

### A2. Runtime data flow (direct → Wizzy)
- **Overlay empty state:** recent (localStorage) + `GET /trendingSearches` +
  `POST /autocomplete` with `productsCount>0` for top products.
- **Overlay typing:** debounced + AbortController `POST /autocomplete` →
  categories / suggestions / products. Submit → navigate
  `resultsPagePath?q=…`.
- **Results page:** mounts on `resultsPagePath` into `resultsMountSelector`,
  reads `?q=`, `POST /products/search`; facet interaction → `POST /products/filter`;
  fires `POST /events/{view,click,converted}`.

### A3. Backend — `apps/backend/src/modules/wizzy/storefront/`
- `GET /wizzy/sdk/wizzy-loader.js` and the hashed widget bundle — serve built
  files (long cache, correct MIME, permissive CORS for cross-origin storefront).
- `GET /wizzy/sdk/config/:merchantId` — **public** JSON: `storeId`, public
  `apiKey`, `inputSelector`, `resultsMountSelector`, `resultsPagePath`, `theme`,
  feature flags. **Never** returns `storeSecret`.
- Migration `0003_add_storefront_config`: add storefront fields to
  `wizzy_configs` (selectors, theme JSON, `searchEnabled`).

### A4. Admin — `apps/admin-wizzy`
- New **"Storefront Search"** screen: copy-paste `<script>` snippet (merchant id
  baked in), selector fields (input / results mount / results path), theme color
  picker, enable toggle, preview link.

## Part B — SDK as an optional architecture pillar

### B1. Golden template `packages/_template-sdk/`
- Distilled **from** the finished `wizzy-sdk` (build wizzy-sdk first as the
  reference impl, then genericize), using the `// TEMPLATE:` marker convention.
- Add `"!packages/_template-sdk"` to `pnpm-workspace.yaml` (excluded from the
  runnable workspace, like `!apps/_template-admin`).

### B2. Capability flag `hasStorefrontSdk`
- New boolean in the PRD template + `STATE.json` schema. Analytics apps `false`;
  `wizzy` `true`. Drives whether the SDK pillar is scaffolded.

### B3. Docs + skill wiring
- **AGENTS.md:** add Lit-3 SDK to *The locked stack*; extend *The `_template`
  golden-path rule* to name `packages/_template-sdk/`; add a (flag-gated) SDK
  step to *Add a new app*.
- **`vendor-scaffolder`:** when `hasStorefrontSdk`, copy+rename
  `packages/_template-sdk` → `packages/<slug>-sdk` and wire the workspace + the
  backend serving routes.
- **`build-app`:** thread `hasStorefrontSdk` through the phases; SDK build is a
  sub-step of frontend work when set.
- **`stack-patterns`:** add a "Storefront SDK patterns" section (Lit component
  recipe, IIFE loader stub, direct-to-vendor client, Shadow DOM theming).
- **`house-conventions` / `prd-architect` / `frontend-builder`:** note the third
  pillar + the flag.

## Acceptance criteria

- [ ] Pasting `<script src=".../wizzy/sdk/wizzy-loader.js?store=<id>">` on a page
      renders the overlay attached to `inputSelector`; loader stays ~2KB and
      lazy-loads the widget on first focus/idle.
- [ ] Overlay empty state shows recent (localStorage) + trending
      (`GET /trendingSearches`) + top products; typing shows categories /
      suggestions / products via debounced `POST /autocomplete` (in-flight
      requests cancelled via AbortController).
- [ ] Submitting a query navigates to `resultsPagePath?q=…`; the results page
      renders the product grid + facet sidebar + sort + pagination via
      `POST /products/search`, and facet changes re-query via
      `POST /products/filter`.
- [ ] All Wizzy calls use `x-store-id` + public `x-api-key` only; the store
      secret is never sent and never returned by `/wizzy/sdk/config/:merchantId`.
- [ ] SDK runs inside Shadow DOM; storefront CSS does not break it and its CSS
      does not leak. Bundle ≤ 30KB raw / 10KB gz (size-limit CI check passes).
- [ ] `POST /events/{view,click,converted}` fire on the corresponding storefront
      interactions.
- [ ] Admin "Storefront Search" screen produces a working snippet and persists
      selectors/theme/enable; migration `0003` applies.
- [ ] `packages/_template-sdk` exists, is excluded from the workspace, and
      contains only `// TEMPLATE:` placeholders (no wizzy specifics).
- [ ] `hasStorefrontSdk` flag exists in the PRD template + STATE schema; AGENTS.md
      and the `vendor-scaffolder` / `build-app` / `stack-patterns` /
      `house-conventions` skills document the SDK pillar and gate it on the flag.
- [ ] `pnpm verify` (`lint && typecheck && test && build`) is green; Vitest unit
      + Playwright E2E suites pass.

## Sequencing

1. `packages/wizzy-sdk` (A1–A2). 2. Backend serving + config + migration `0003`
(A3). 3. Admin screen (A4). 4. Distill `_template-sdk` + AGENTS.md + skill wiring
(Part B). 5. Tests + `pnpm verify`.

## Out of scope (v1)

- Storefront-repo / Next.js native event lifecycle wiring (Frontend Core owns it).
- Wizzy ScriptTag auto-injection (remains `pending_api`).
- Wizzy advanced widgets (Visual Search, Conversational AI, Reels).
- Metafield / custom-attribute mapping.
- A CDN for the bundle (backend-served for now).
- Making the SDK mandatory for every app (it is opt-in).
