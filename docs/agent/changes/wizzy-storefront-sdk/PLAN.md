# Wizzy storefront search SDK — implementation plan

**Goal:** Ship an embeddable, pasteable Lit-3 storefront search SDK for the
`wizzy` app (overlay + faceted results page, direct-to-Wizzy), backend-served +
admin-configured, and promote "storefront SDK" to an opt-in architecture pillar.
**Spec:** docs/agent/changes/wizzy-storefront-sdk/SPEC.md
**Execution:** invoke the `execute` skill (it asks subagent-driven vs inline).

## Conventions for every task
- Commands run from repo root. Targeted loops:
  - SDK: `pnpm --filter @ratio-app/wizzy-sdk test`
  - backend: `pnpm --filter @ratio-app/backend test`
  - shared: `pnpm --filter @ratio-app/shared test`
  - admin: `pnpm --filter @ratio-app/admin-wizzy test`
- `pnpm verify` = `pnpm -r lint && pnpm -r typecheck && pnpm --filter @ratio-app/shared build && pnpm -r test && pnpm -r build`.
- Commit per task with a conventional commit `feat(wizzy): …` / `feat(skills): …`.
- Decisions baked in here: widget served at a **stable** path
  (`/wizzy/sdk/wizzy-widget.js`), cache-busted by a `version` field from the
  config endpoint (no hashed filename routing). Loader = classic **IIFE**;
  widget = **ESM**. All Wizzy calls send `x-store-id` + public `x-api-key` only.

---

## Phase 0 — package scaffold

### Task 1: Create `packages/wizzy-sdk` package skeleton
**Files:**
- Create: `packages/wizzy-sdk/package.json`
- Create: `packages/wizzy-sdk/tsconfig.json`
- Create: `packages/wizzy-sdk/vite.config.ts`
- Create: `packages/wizzy-sdk/.size-limit.json`
- Create: `packages/wizzy-sdk/src/version.ts`
- Create: `packages/wizzy-sdk/src/version.test.ts`
- Reference copy: `packages/wizzy-sdk/docs/wizzy-search-api-contract.md` (copy from scratchpad)

- [ ] Write the failing test `src/version.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { SDK_VERSION } from './version';
  describe('version', () => {
    it('is a semver string', () => {
      expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });
  ```
- [ ] Run it — expect FAIL: `pnpm --filter @ratio-app/wizzy-sdk test`
- [ ] Implement `package.json`:
  ```json
  {
    "name": "@ratio-app/wizzy-sdk",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "scripts": {
      "build": "vite build",
      "typecheck": "tsc --noEmit",
      "test": "vitest run",
      "test:watch": "vitest",
      "size": "size-limit",
      "lint": "biome check src"
    },
    "dependencies": { "lit": "^3.2.0" },
    "devDependencies": {
      "@size-limit/preset-small-lib": "^11.0.0",
      "@types/node": "^22.0.0",
      "happy-dom": "^15.0.0",
      "size-limit": "^11.0.0",
      "typescript": "^5.6.0",
      "vite": "^6.0.0",
      "vitest": "^2.1.0"
    }
  }
  ```
- [ ] Implement `tsconfig.json` (extends root base, strict, DOM libs):
  ```json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "lib": ["ES2022", "DOM", "DOM.Iterable"],
      "experimentalDecorators": true,
      "useDefineForClassFields": false,
      "moduleResolution": "Bundler",
      "noEmit": true
    },
    "include": ["src"]
  }
  ```
- [ ] Implement `vite.config.ts` — two library entries (loader IIFE, widget ESM) + vitest happy-dom:
  ```ts
  import { resolve } from 'node:path';
  import { defineConfig } from 'vite';
  export default defineConfig({
    build: {
      target: 'es2019',
      lib: { entry: { /* filled by later tasks */ }, formats: [] },
      rollupOptions: {
        output: [
          { entryFileNames: 'wizzy-loader.js', format: 'iife', name: 'WizzyLoader',
            dir: 'dist', exports: 'none' },
          { entryFileNames: 'wizzy-widget.js', format: 'es', dir: 'dist' },
        ],
        input: {
          'wizzy-loader': resolve(__dirname, 'src/loader.ts'),
          'wizzy-widget': resolve(__dirname, 'src/widget.ts'),
        },
      },
    },
    test: { environment: 'happy-dom', include: ['src/**/*.test.ts'] },
  });
  ```
  > Note: leave the two entrypoint files as `export {}` stubs until Tasks 9/12 fill them, so the package builds from Task 1.
- [ ] Create `src/loader.ts` and `src/widget.ts` as `export {};` placeholders (real impl in later tasks).
- [ ] Implement `src/version.ts`: `export const SDK_VERSION = '0.1.0';`
- [ ] Implement `.size-limit.json`:
  ```json
  [
    { "path": "dist/wizzy-loader.js", "limit": "3 KB" },
    { "path": "dist/wizzy-widget.js", "limit": "10 KB" }
  ]
  ```
- [ ] Copy `scratchpad/wizzy-search-api-contract.md` → `packages/wizzy-sdk/docs/wizzy-search-api-contract.md`.
- [ ] Run it — expect PASS: `pnpm --filter @ratio-app/wizzy-sdk test`
- [ ] `pnpm install && pnpm --filter @ratio-app/wizzy-sdk build && pnpm verify`

---

## Phase 1 — shared types + SDK core logic

### Task 2: Wizzy search response + storefront-config Zod schemas (shared)
**Files:**
- Create: `packages/shared/src/schemas/wizzy-search.ts`
- Create: `packages/shared/src/schemas/wizzy-search.test.ts`
- Modify: `packages/shared/src/index.ts` (barrel export)

- [ ] Write failing `wizzy-search.test.ts` — parse a real-shaped autocomplete +
  search payload (from the saved contract) and a storefront-config object:
  ```ts
  import { describe, expect, it } from 'vitest';
  import {
    wizzyAutocompleteResultSchema,
    wizzySearchResultSchema,
    wizzyStorefrontConfigSchema,
  } from './wizzy-search';
  describe('wizzy-search schemas', () => {
    it('parses an autocomplete payload', () => {
      const r = wizzyAutocompleteResultSchema.parse({
        payload: {
          categories: [{ value: 'Creatine Monohydrate', payload: [], filters: {} }],
          others: [{ value: 'Creatine Dynamite', payload: [], filters: {} }],
          brands: [], pages: [], banners: [],
          products: [{ id: '1', name: 'Wellcore Creatine', url: '/p/1',
            mainImage: 'https://x/i.jpg', price: 699, finalPrice: 588, sellingPrice: 588,
            inStock: true }],
        },
      });
      expect(r.payload.products[0].sellingPrice).toBe(588);
    });
    it('parses a search payload with facets', () => {
      const r = wizzySearchResultSchema.parse({
        payload: { result: [], total: 0, pages: 0,
          facets: [{ label: 'Brand', key: 'brands', type: 'list', position: 'left', order: 1 }] },
      });
      expect(r.payload.facets[0].key).toBe('brands');
    });
    it('parses storefront config and rejects a stray secret', () => {
      const c = wizzyStorefrontConfigSchema.parse({
        storeId: 's1', apiKey: 'pub', version: '0.1.0',
        inputSelector: '#search', resultsMountSelector: '#results',
        resultsPagePath: '/search', searchEnabled: true,
        theme: { primary: '#0fb3a9' },
      });
      expect(c).not.toHaveProperty('storeSecret');
    });
  });
  ```
- [ ] Run — expect FAIL: `pnpm --filter @ratio-app/shared test`
- [ ] Implement `wizzy-search.ts` (Zod): `wizzyProductSchema` (id, name, url,
  mainImage, hoverImage?, brand?, price, finalPrice, sellingPrice, inStock,
  discountPercentage?, avgRatings?, totalReviews?), `wizzySuggestionSchema`
  (`value`, `payload[]`, `filters` passthrough), `wizzyAutocompleteResultSchema`
  (`payload.{categories[],brands[],others[],pages[]?,products[],banners[]?}`),
  `wizzyFacetSchema` (`label, order, position, key, type`),
  `wizzySearchResultSchema` (`payload.{result[],total,pages,facets[],redirectTo?}`),
  `wizzyTrendingResultSchema` (`payload.queries[]`), and
  `wizzyStorefrontConfigSchema` (`storeId, apiKey, version, inputSelector,
  resultsMountSelector, resultsPagePath, searchEnabled, theme:{primary,...}`).
  Use `.strict()` on the storefront-config schema so a leaked `storeSecret`
  fails parse. Export inferred types.
- [ ] Add to `packages/shared/src/index.ts`: `export * from './schemas/wizzy-search';`
- [ ] Run — expect PASS: `pnpm --filter @ratio-app/shared test`
- [ ] `pnpm --filter @ratio-app/shared build && pnpm verify`

### Task 3: `WizzyClient` — typed REST wrapper (fetch + AbortController)
**Files:** Create `packages/wizzy-sdk/src/client.ts` + `src/client.test.ts`
- [ ] Write failing `client.test.ts` — assert headers, formData body, and abort:
  ```ts
  import { beforeEach, describe, expect, it, vi } from 'vitest';
  import { WizzyClient } from './client';
  function mockFetch(json: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(json),
      { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  describe('WizzyClient', () => {
    const cfg = { baseUrl: 'https://api.wizsearch.in/v1', storeId: 's1', apiKey: 'pub', userId: 'u1' };
    it('sends public auth headers and form body to /autocomplete', async () => {
      const fetchImpl = mockFetch({ payload: { categories: [], brands: [], others: [], products: [] } });
      const c = new WizzyClient(cfg, fetchImpl);
      await c.autocomplete('crea', { productsCount: 6 });
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://api.wizsearch.in/v1/autocomplete');
      expect((init.headers as Record<string, string>)['x-store-id']).toBe('s1');
      expect((init.headers as Record<string, string>)['x-api-key']).toBe('pub');
      expect(init.headers).not.toHaveProperty('x-store-secret');
      expect(String(init.body)).toContain('q=crea');
    });
    it('aborts the previous autocomplete when a new one starts', async () => {
      const fetchImpl = vi.fn((_u, init: RequestInit) => new Promise((_res, rej) =>
        (init.signal as AbortSignal).addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))));
      const c = new WizzyClient(cfg, fetchImpl as unknown as typeof fetch);
      const p1 = c.autocomplete('a').catch((e) => e);
      c.autocomplete('ab').catch(() => {});
      expect((await p1).name).toBe('AbortError');
    });
  });
  ```
- [ ] Run — expect FAIL: `pnpm --filter @ratio-app/wizzy-sdk test`
- [ ] Implement `client.ts`:
  - constructor `(cfg: {baseUrl,storeId,apiKey,userId?}, fetchImpl=fetch)`.
  - private `post(path, params)` → `application/x-www-form-urlencoded` body,
    headers `x-store-id`, `x-api-key`, optional `x-wizzy-userId`; parse JSON via
    the shared schemas; throw a typed `WizzyClientError(status,message)` on !ok.
  - `autocomplete(q, opts)` holds an `AbortController` instance field; aborts the
    prior call before issuing a new one. Validates with `wizzyAutocompleteResultSchema`.
  - `search(q, opts)` → `/products/search`, parsed by `wizzySearchResultSchema`.
  - `filter(filterModel, opts)` → `/products/filter` with `filters` = JSON string.
  - `trending(size=6)` → `GET /trendingSearches?size=`, `wizzyTrendingResultSchema`.
  - `event(kind, body)` → `POST /events/{kind}` (fire-and-forget, ignore errors).
- [ ] Run — expect PASS: `pnpm --filter @ratio-app/wizzy-sdk test`
- [ ] `pnpm verify`

### Task 4: `recent-store` (localStorage recent searches)
**Files:** Create `packages/wizzy-sdk/src/recent-store.ts` + `src/recent-store.test.ts`
- [ ] Write failing test: `add('creatine')` then `add('bcaa')` → `list()` returns
  `['bcaa','creatine']` (most-recent-first, deduped, capped at 8); `clear()`
  empties; survives a fresh instance reading the same `localStorage` key.
- [ ] Run — expect FAIL.
- [ ] Implement: key `wizzy:recent:<storeId>`; `list()`, `add(q)` (trim, dedupe
  case-insensitive, unshift, slice 8, persist), `remove(q)`, `clear()`. Guard
  `try/catch` around `localStorage` (private-mode safe).
- [ ] Run — expect PASS.
- [ ] `pnpm verify`

### Task 5: `anon-id` (stable `x-wizzy-userId`)
**Files:** Create `packages/wizzy-sdk/src/anon-id.ts` + `src/anon-id.test.ts`
- [ ] Write failing test: `getAnonId()` returns the same value across two calls;
  matches `/^wz_[a-z0-9]+$/`.
- [ ] Run — expect FAIL.
- [ ] Implement: read `localStorage['wizzy:uid']`; if absent, generate
  `wz_${crypto.randomUUID().replace(/-/g,'')}` (fallback to time+counter string
  if `crypto` absent — note: do not use `Date.now()` inside workflow scripts, but
  this is runtime SDK code so it is fine), persist, return.
- [ ] Run — expect PASS.
- [ ] `pnpm verify`

### Task 6: Loader stub (`src/loader.ts`, IIFE)
**Files:** Modify `packages/wizzy-sdk/src/loader.ts`; Create `src/loader.test.ts`
- [ ] Write failing `loader.test.ts` (happy-dom): set a `<script id="wizzy-sdk"
  src="https://cdn/wizzy/sdk/wizzy-loader.js?store=m1">`, mock `fetch` to return
  a storefront config, call `bootWizzy()`; assert it (a) fetched
  `/wizzy/sdk/config/m1`, (b) on focus of the input matched by `inputSelector`,
  appended a `<script type="module" src=".../wizzy-widget.js?v=0.1.0">`.
- [ ] Run — expect FAIL.
- [ ] Implement `loader.ts`: read the current `<script>`'s `?store=` + origin;
  `fetch(`${origin}/wizzy/sdk/config/${store}`)`; parse with
  `wizzyStorefrontConfigSchema`; stash config on `window.__WIZZY__`; attach a
  one-shot `focusin`/`requestIdleCallback` trigger that injects the widget ESM
  bundle (`<origin>/wizzy/sdk/wizzy-widget.js?v=<version>`). Export `bootWizzy`
  for the test; auto-run it on load. Keep it dependency-free (no Lit) to stay
  under 3 KB.
- [ ] Run — expect PASS.
- [ ] `pnpm --filter @ratio-app/wizzy-sdk build` (confirm `dist/wizzy-loader.js`
  is IIFE) → `pnpm --filter @ratio-app/wizzy-sdk size` (loader ≤ 3 KB) → `pnpm verify`

---

## Phase 2 — Lit components (widget)

### Task 7: Theme + shared styles
**Files:** Create `packages/wizzy-sdk/src/ui/theme.ts` + `src/ui/theme.test.ts`
- [ ] Write failing test: `themeVars({ primary: '#0fb3a9' })` returns a string
  containing `--wz-primary: #0fb3a9`.
- [ ] Run — expect FAIL.
- [ ] Implement `theme.ts`: `themeVars(theme)` → CSS custom-property block; a
  `baseStyles` `css` tagged template (Lit) used by every component; defaults for
  `--wz-primary`, `--wz-radius`, `--wz-fg`, `--wz-bg`, `--wz-muted`.
- [ ] Run — expect PASS.
- [ ] `pnpm verify`

### Task 8: `<wizzy-product-card>`
**Files:** Create `packages/wizzy-sdk/src/ui/product-card.ts` + `.test.ts`
- [ ] Write failing test (happy-dom + Lit): set `.product` to a fixture, await
  `el.updateComplete`, assert shadow root renders the name, the `finalPrice`
  formatted as `₹588`, the strike-through `price` when `finalPrice < price`, and
  the discount `%`.
- [ ] Run — expect FAIL.
- [ ] Implement a Lit element `@customElement('wizzy-product-card')` with a
  `@property({attribute:false}) product` and an INR formatter
  (`new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0})`).
  Renders image, name (anchor to `product.url`), price block. Uses `baseStyles`.
- [ ] Run — expect PASS.
- [ ] `pnpm verify`

### Task 9: `<wizzy-search-overlay>` + widget entry
**Files:** Create `packages/wizzy-sdk/src/ui/search-overlay.ts` + `.test.ts`;
Modify `packages/wizzy-sdk/src/widget.ts` (entry: import components, read
`window.__WIZZY__`, attach overlay to `inputSelector`, mount results page on
`resultsPagePath`).
- [ ] Write failing `search-overlay.test.ts`: instantiate with a stub
  `WizzyClient` whose `trending()`/`autocomplete()` return fixtures and a
  `recent-store`. Assert: (a) empty state renders recent + trending + top
  products; (b) setting `.query='crea'` and flushing the debounce calls
  `autocomplete` and renders a CATEGORIES list (from `categories`), a suggestions
  list (from `others`/`brands`), and a TOP PRODUCTS grid; (c) pressing Enter
  dispatches a `wizzy-submit` event with `{ q }`.
- [ ] Run — expect FAIL.
- [ ] Implement the overlay element: properties `client`, `recent`, `query`,
  `open`; a 180ms debounce (timer field) wrapping `client.autocomplete`; render
  empty vs typing states matching the screenshots (CATEGORIES column, TRENDING /
  suggestions, TOP PRODUCTS grid of `<wizzy-product-card>`); clicking a
  suggestion sets the query + dispatches `wizzy-submit`; Enter dispatches
  `wizzy-submit`. All inside Shadow DOM with `themeVars` applied.
- [ ] Implement `widget.ts`: read config, construct `WizzyClient` + `recent-store`
  + `anon-id`; find `inputSelector`, create a host element, position the overlay
  under the input, wire `input`/`focusin`/`keydown`; on `wizzy-submit` navigate
  to `resultsPagePath?q=`; if `location.pathname` matches `resultsPagePath`,
  mount `<wizzy-results-page>` into `resultsMountSelector`.
- [ ] Run — expect PASS.
- [ ] `pnpm verify`

### Task 10: `<wizzy-facet-list>` + `<wizzy-facet-range>`
**Files:** Create `packages/wizzy-sdk/src/ui/facet-list.ts`, `src/ui/facet-range.ts` + `.test.ts` each
- [ ] Write failing tests: `facet-list` renders checkboxes from
  `filterSuggestions` values and dispatches `wizzy-facet-change` with
  `{key, selected[]}` on toggle; `facet-range` renders min/max number inputs and
  dispatches `{key, range:{gte,lte}}` on change.
- [ ] Run — expect FAIL.
- [ ] Implement both Lit elements (Shadow DOM, `baseStyles`).
- [ ] Run — expect PASS.
- [ ] `pnpm verify`

### Task 11: `<wizzy-results-page>`
**Files:** Create `packages/wizzy-sdk/src/ui/results-page.ts` + `.test.ts`
- [ ] Write failing test with a stub `WizzyClient`: set `.query='creatine'`,
  await render → calls `search`, renders the result grid (`wizzy-product-card`
  per item), the facet sidebar (one `facet-list`/`facet-range` per
  `facets[]` by `type`), result `total`, and a sort `<select>`. Dispatching
  `wizzy-facet-change` calls `client.filter` with the assembled CommonFilter
  model and re-renders.
- [ ] Run — expect FAIL.
- [ ] Implement: properties `client`, `query`; internal `@state` for results +
  selected filters + sort + page; `firstUpdated` runs `search`; facet/sort/page
  changes assemble a `CommonFilter` and call `client.filter`; fires
  `client.event('view', …)` on load and `client.event('click', …)` on card
  click. Left sidebar = facets with `position:left`; top = sort/`top` facets.
- [ ] Run — expect PASS.
- [ ] `pnpm --filter @ratio-app/wizzy-sdk size` (widget ≤ 10 KB gz) → `pnpm verify`

### Task 12: Playwright E2E
**Files:** Create `packages/wizzy-sdk/playwright.config.ts`,
`packages/wizzy-sdk/e2e/fixture.html`, `packages/wizzy-sdk/e2e/search.spec.ts`;
Modify `package.json` (add `"e2e": "playwright test"`, devDep `@playwright/test`).
- [ ] Write failing `search.spec.ts`: serve `fixture.html` (a page with a
  `#search` input + `#results` div + a `<script>` loading the built
  `wizzy-loader.js`, with `window.__WIZZY__` config pre-seeded and Wizzy API
  calls intercepted via `page.route('**/api.wizsearch.in/**', …)` returning
  fixtures). Assert: focusing `#search` loads the widget; typing `crea` shows
  categories + products; pressing Enter navigates to `?q=crea`; the results page
  renders a grid + facets; toggling a facet re-queries.
- [ ] Run — expect FAIL: `pnpm --filter @ratio-app/wizzy-sdk build && pnpm --filter @ratio-app/wizzy-sdk e2e`
- [ ] Implement `playwright.config.ts` (chromium, `webServer` = `vite preview`
  over the package `dist` + a static `e2e` dir, or `@playwright/test`'s built-in
  static server) and the route-mocked spec.
- [ ] Run — expect PASS.
- [ ] `pnpm verify` (note: keep `e2e` OUT of the default `test` script so
  `pnpm -r test` stays Playwright-free; CI runs `e2e` separately).

---

## Phase 3 — backend serving + config

### Task 13: Migration `0003_add_storefront_config` + db types + shared config fields
**Files:**
- Create: `apps/backend/src/modules/wizzy/db/migrations/0003_add_storefront_config.ts`
- Modify: `apps/backend/src/modules/wizzy/db/types.ts` (add columns to `WizzyConfigsTable`)
- Modify: `packages/shared/src/schemas/wizzy-config.ts` (input + output: add
  `searchEnabled`, `inputSelector`, `resultsMountSelector`, `resultsPagePath`,
  `themePrimary`)
- Create/Modify: `packages/shared/src/schemas/wizzy-config.test.ts` (assert new fields default + parse)
- [ ] Write failing shared test asserting the new config fields parse with
  defaults (`searchEnabled:false`, `resultsPagePath:'/search'`,
  `inputSelector:'#search'`, `resultsMountSelector:'#wizzy-results'`,
  `themePrimary:'#0fb3a9'`) and appear redacted-safe in the output schema.
- [ ] Run — expect FAIL: `pnpm --filter @ratio-app/shared test`
- [ ] Implement migration `up`: `ALTER TABLE wizzy_configs ADD COLUMN
  search_enabled TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN input_selector
  VARCHAR(255) NOT NULL DEFAULT '#search', ADD COLUMN results_mount_selector
  VARCHAR(255) NOT NULL DEFAULT '#wizzy-results', ADD COLUMN results_page_path
  VARCHAR(255) NOT NULL DEFAULT '/search', ADD COLUMN theme_primary VARCHAR(32)
  NOT NULL DEFAULT '#0fb3a9'`; `down` drops them. (Additive; mirror 0002 style.)
- [ ] Add matching columns to `WizzyConfigsTable` in `db/types.ts` (with
  `Generated<>` where defaulted).
- [ ] Extend `wizzyConfigInputSchema` + `wizzyConfigSchema` with the new fields.
- [ ] Run — expect PASS; then `pnpm --filter @ratio-app/shared build`.
- [ ] `pnpm verify`

### Task 14: `WizzyConfigService` storefront fields
**Files:** Modify `apps/backend/src/modules/wizzy/config/config.service.ts`;
Modify/Create `apps/backend/test/unit/apps/wizzy/wizzy-config.service.test.ts`
- [ ] Write failing unit test: `upsert` persists the storefront fields and
  `getByMerchantId`/`toOutput` returns them; `toOutput` still NEVER exposes the
  secret/apiKey raw.
- [ ] Run — expect FAIL: `pnpm --filter @ratio-app/backend test`
- [ ] Implement: add the 5 fields to `cols` in `upsert` and to `toOutput`.
- [ ] Run — expect PASS.
- [ ] `pnpm verify`

### Task 15: `StorefrontController` — serve loader/widget + public config
**Files:**
- Create: `apps/backend/src/modules/wizzy/storefront/storefront.controller.ts`
- Create: `apps/backend/src/modules/wizzy/storefront/storefront-config.service.ts`
- Modify: `apps/backend/src/modules/wizzy/wizzy.module.ts` (register controller + service)
- Create: `apps/backend/test/unit/apps/wizzy/storefront-config.service.test.ts`
- [ ] Write failing test: `StorefrontConfigService.publicConfig(merchantId)`
  returns `{storeId, apiKey, version, inputSelector, resultsMountSelector,
  resultsPagePath, searchEnabled, theme:{primary}}` with the **decrypted public
  apiKey** but NO `storeSecret`; throws/returns disabled when `searchEnabled` is
  false or `storeId/apiKey` missing.
- [ ] Run — expect FAIL: `pnpm --filter @ratio-app/backend test`
- [ ] Implement `StorefrontConfigService` (inject `WIZZY_DB_TOKEN` + `WIZZY_CRYPTO`;
  read row, decrypt `apiKeyEnc`, map to the public shape, parse through
  `wizzyStorefrontConfigSchema` to guarantee no secret leaks).
- [ ] Implement `StorefrontController` (`@Controller('wizzy/sdk')`, NO merchant
  guard — public):
  - `GET wizzy-loader.js` / `GET wizzy-widget.js` → read the built file from the
    resolved `@ratio-app/wizzy-sdk/dist` path (same `process.cwd()` resolution
    style as `registerStaticAdmin`), set `content-type: text/javascript`,
    `access-control-allow-origin: *`, `cache-control: public, max-age=3600`.
  - `GET config/:merchantId` → `StorefrontConfigService.publicConfig`, JSON,
    `access-control-allow-origin: *`, `cache-control: no-store`.
  - Register both providers in `wizzy.module.ts`.
- [ ] Run — expect PASS.
- [ ] `pnpm verify`

---

## Phase 4 — admin "Storefront Search" screen

### Task 16: Storefront config hook + route
**Files:**
- Modify: `apps/admin-wizzy/src/hooks/useConfig.ts` (new fields flow through the
  existing `WizzyConfigInput` — no change needed if Task 13 extended the schema;
  add a `useStorefrontSnippet()` helper if useful)
- Create: `apps/admin-wizzy/src/routes/storefront.tsx`
- Create: `apps/admin-wizzy/src/routes/storefront.test.tsx`
- Modify: `apps/admin-wizzy/src/components/Navbar.tsx` (add the nav link)
- [ ] Write failing `storefront.test.tsx` (existing `test-utils` render): renders
  the snippet `<script src=".../wizzy/sdk/wizzy-loader.js?store=<merchantId>">`,
  the selector inputs bound to config, the theme color input, and the enable
  toggle; saving calls `useUpdateConfig`.
- [ ] Run — expect FAIL: `pnpm --filter @ratio-app/admin-wizzy test`
- [ ] Implement `storefront.tsx` following the `config.tsx` form pattern
  (`react-hook-form` + `zodResolver(wizzyConfigInputSchema)`, Orion components),
  a read-only snippet box with a copy button, selector + theme + enable fields,
  and a preview link to `storeUrl`. Add the Navbar link.
- [ ] Run — expect PASS.
- [ ] `pnpm --filter @ratio-app/admin-wizzy build && pnpm verify`

---

## Phase 5 — SDK as an opt-in architecture pillar (Part B)

### Task 17: Distill `packages/_template-sdk` from `wizzy-sdk`
**Files:**
- Create: `packages/_template-sdk/**` (copy of `wizzy-sdk` with all `wizzy`
  identifiers replaced by `// TEMPLATE:`-marked placeholders + `__SLUG__`)
- Modify: `pnpm-workspace.yaml` (add `"!packages/_template-sdk"`)
- [ ] Write failing check (a tiny node/vitest script or a `grep` assertion in a
  test): `packages/_template-sdk` contains no literal `wizzy` and every
  vendor-specific spot carries a `// TEMPLATE:` marker; `pnpm -r typecheck` does
  NOT include `_template-sdk` (workspace-excluded).
- [ ] Run — expect FAIL.
- [ ] Implement: copy the built-out `wizzy-sdk` tree, strip wizzy specifics to
  `// TEMPLATE:` markers (client base path, component prefixes → `__slug__-*`,
  config endpoint path), set `name` to `@ratio-app/__slug__-sdk`. Add the
  workspace exclusion.
- [ ] Run — expect PASS.
- [ ] `pnpm install && pnpm verify` (confirm `_template-sdk` is excluded).

### Task 18: `hasStorefrontSdk` capability flag
**Files:**
- Modify: `docs/agent/PRD.template.md` (add a `Storefront SDK?` field)
- Modify: `docs/agent/STATE.schema.md` (document `hasStorefrontSdk`)
- Modify: `docs/agent/apps/wizzy/STATE.json` (`"hasStorefrontSdk": true`)
- [ ] (Docs task — no unit test.) Add the flag to the PRD template + STATE schema,
  set `wizzy` to `true`. Leave the four analytics apps untouched (implicitly
  `false`).
- [ ] Verify: `pnpm verify` (docs-only; ensures nothing breaks).

### Task 19: AGENTS.md — document the third pillar
**Files:** Modify `AGENTS.md`
- [ ] Add to *The locked stack*: a "Storefront SDK (optional)" bullet — Lit 3 +
  Vite library mode, in `packages/<slug>-sdk`, opt-in via `hasStorefrontSdk`.
- [ ] Extend *The `_template` golden-path rule* to name `packages/_template-sdk/`
  as the third golden source (alongside the backend module + admin templates).
- [ ] Add a flag-gated SDK step to *Add a new app*.
- [ ] Verify: `pnpm verify`.

### Task 20: Wire the agent-builder skills
**Files:**
- Modify: `.agents/skills/vendor-scaffolder/SKILL.md` — when `hasStorefrontSdk`,
  copy+rename `packages/_template-sdk` → `packages/<slug>-sdk`, add the workspace
  entry, and add the backend `storefront/` serving routes.
- Modify: `.agents/skills/build-app/SKILL.md` — thread `hasStorefrontSdk` through
  phases; SDK build is a frontend sub-step when set.
- Modify: `.agents/skills/stack-patterns/SKILL.md` — add a "Storefront SDK
  patterns" section (Lit element recipe, IIFE loader stub, direct-to-vendor
  `WizzyClient`-style client, Shadow DOM theming, the public-config endpoint).
- Modify: `.agents/skills/house-conventions/SKILL.md` — note the third pillar +
  the flag + the `packages/<slug>-sdk` naming.
- Modify: `.agents/skills/prd-architect/SKILL.md` + `.agents/skills/frontend-builder/SKILL.md`
  — capture/honor `hasStorefrontSdk`.
- [ ] (Docs/skills task.) Make the edits above, cross-referencing Task 17–19.
- [ ] Verify: `pnpm verify` (skills are markdown; ensure repo still green).

---

## Phase 6 — close-out

### Task 21: Full verification + state + journal
**Files:** Modify `docs/agent/apps/wizzy/STATE.json`; Create/append
`docs/agent/apps/wizzy/CONTEXT.md` (via the `remember` skill).
- [ ] Run the full `pnpm verify` — all green.
- [ ] Run `pnpm --filter @ratio-app/wizzy-sdk build && pnpm --filter @ratio-app/wizzy-sdk size && pnpm --filter @ratio-app/wizzy-sdk e2e`.
- [ ] Apply migration locally and smoke `GET /wizzy/sdk/config/:merchantId` +
  `GET /wizzy/sdk/wizzy-loader.js`.
- [ ] Update `STATE.json` (note the storefront-SDK feature shipped) and record a
  change-journal entry via `remember` (notable feature). Update
  `docs/agent/FEATURES.md` if a capability lifecycle changed.

---

## Acceptance-criteria → task map
- Paste tag renders overlay, ~2KB loader, lazy widget → Tasks 6, 9, 15.
- Overlay empty/typing states (recent/trending/categories/suggestions/products) → Tasks 4, 9.
- Submit → results page with grid + facets + sort + pagination; facet re-query → Tasks 10, 11.
- Public auth only; secret never sent/returned → Tasks 3, 15.
- Shadow DOM isolation; ≤30KB/10KB size-limit → Tasks 7–11.
- Events fire → Tasks 3, 11.
- Admin screen produces snippet + persists; migration 0003 → Tasks 13, 16.
- `_template-sdk` excluded + marker-only → Task 17.
- `hasStorefrontSdk` + AGENTS.md + skills → Tasks 18, 19, 20.
- `pnpm verify` green; Vitest + Playwright pass → Tasks 12, 21.
```
