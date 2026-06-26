# wizzy — context

Living context for the Wizzy app (AI Search & Discovery). Read before touching
this module. Standing context first; dated change journal below (newest first).

## Standing context
- **Two halves.** (1) **Catalog sync** (existing): pushes the merchant's Ratio
  catalog to Wizzy's hosted index via `POST /products/save|delete` (private
  endpoints, `x-store-id` + `x-store-secret` + `x-api-key`), with initial bulk
  sync + hourly reconcile + SQS worker + product webhooks. (2) **Storefront
  search SDK** (new, 2026-06-26): an embeddable Lit widget that renders the
  search overlay + faceted results page on the storefront, calling Wizzy's
  **public** search API directly from the browser.
- **Wizzy API base** = `https://api.wizsearch.in/v1`. Full search contract saved
  at `packages/wizzy-sdk/docs/wizzy-search-api-contract.md`.
- **Public vs private auth.** Catalog (write) endpoints need the **store secret**.
  Search/autocomplete (read) endpoints are **public**: `x-store-id` + public
  `x-api-key` ONLY — the secret must NEVER be sent on them, and CORS is wildcard.
- **The storefront SDK calls Wizzy directly** (no backend proxy on the hot path).
  The backend only serves the SDK bundles + a redacted public config; it never
  returns the store secret.
- **Prices:** the SDK renders whatever Wizzy returns (rupee floats:
  `finalPrice`/`sellingPrice`/`price`). ⚠️ The Ratio→Wizzy catalog transform's
  price handling must match the verified core learning that **Ratio webhook
  prices are integer PAISE (÷100)** (see google CONTEXT, verified 2026-06-22).
  If the catalog push sends paise, the storefront will show inflated prices —
  verify against a live store during integration.
- **ScriptTag auto-injection stays `pending_api`** (Draft API). Delivery is a
  **manually pasted `<script>`** for now: `<script
  src=".../wizzy/sdk/wizzy-loader.js?store=<merchantId>">`.
- **SDK bundles** (`packages/wizzy-sdk`, Lit 3 + Vite lib): `wizzy-loader.js`
  (IIFE, the pasted tag), `wizzy-widget.js` (ESM overlay), `wizzy-results.js`
  (ESM results page). Size-limit gates: 3 / 10 / 16 KB brotli. Zod is kept OUT of
  the bundle via type-only shared imports.

## Change journal

### 2026-06-26 — feature — Storefront search SDK (overlay + faceted results) + opt-in SDK pillar
- **What:** Built `packages/wizzy-sdk` (`@ratio-app/wizzy-sdk`, Lit 3 + Vite
  library mode): a pasted-`<script>` storefront SDK reproducing Wizzy's search
  UX. Loader (IIFE) → lazy-injects the overlay (`<wizzy-search-overlay>`: recent
  [localStorage] + trending + categories + suggestions + top products) and, on
  the results route, the results page (`<wizzy-results-page>`: product grid +
  facet sidebar via `<wizzy-facet-list>`/`<wizzy-facet-range>` + sort +
  pagination). `WizzyClient` calls `api.wizsearch.in/v1` directly (native fetch +
  AbortController; public auth only). Backend `wizzy/storefront/`
  (`StorefrontController` at `/wizzy/sdk/*`, public) serves the 3 bundles + a
  redacted `config/:merchantId`. Migration `0003_add_storefront_config`. Admin
  "Storefront Search" screen (snippet + selectors + theme + enable). Part B
  promoted "storefront SDK" to an opt-in third pillar (`packages/_template-sdk`,
  `hasStorefrontSdk` flag, AGENTS.md + scaffolder/build-app/stack-patterns/
  house-conventions/prd-architect/frontend-builder).
- **Why:** Wellversed (and other migrating brands) need best-in-class AI search
  on Ratio; ScriptTag auto-injection is Draft, so a manually pasted SDK ships it
  now and auto-injects later when the API lands.
- **Definition of done:** `pnpm verify` green; wizzy-sdk size-limit (loader 0.5KB
  / widget 9.48KB / results 9.54KB brotli) + Playwright E2E (3/3, serial) green.
- **Files:** `packages/wizzy-sdk/**`, `packages/_template-sdk/**`,
  `packages/shared/src/schemas/wizzy-search.ts` (+ `wizzy-config.ts` fields),
  `apps/backend/src/modules/wizzy/storefront/**` + `db/migrations/0003_*`,
  `apps/admin-wizzy/src/routes/storefront.tsx`, AGENTS.md, `.agents/skills/*`.
- **Links:** spec/plan `docs/agent/changes/wizzy-storefront-sdk/`; ADR
  [0004](../../context/decisions/0004-storefront-sdk-pillar.md).
