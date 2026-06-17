# google — context

Living context for the Google app (GA4 + Google Ads + GMC). Read before touching
this module. Standing context first; dated change journal below (newest first).

## Standing context
- **Three integrations, two delivery paths.** GA4 + Google Ads are client-side
  pixels; GMC is server-side feed sync via Content API for Shopping v2.1.
- **Pixel config is DB-driven**, injected as a `window.__GOOGLE_RATIO_CONFIG__`
  prelude before the `static/google-pixel.js` bundle. GA4 registers
  `isolated:false` (fans out); Ads owns its conversions via `send_to`.
- **Web Pixels API is Draft** → registration is guarded and records
  `pending_api`; the script-tag endpoint (`/google/sdk/:merchantId.js`) is the
  working delivery path.
- **Webhook topics are slash-form** (`products/create|update|delete`,
  `app/uninstalled`) — TRD open item R1, verify against a live delivery.
- **Ratio prices are integer paise** — convert to major units for GMC.
- **Secrets:** GMC service-account key + Google OAuth tokens are encrypted at
  rest; config GET returns `hasGmcKey`, never the value.
- **Local dev:** dummy merchant id `dev-merchant` is seeded in `google_app`;
  open the admin at `/?merchant-id=dev-merchant`. Backend loads env via a symlink
  `apps/backend/.env → ../../.env`.

## Change journal

### 2026-06-17 — fix — GMC service-account key fallback for OAuth merchants
- **Bug:** the GMC section showed the green "Authorized — no service-account key needed"
  note (and hid the key field) for ANY `connectionMethod === 'oauth'`, even when OAuth
  discovery found NO Merchant Center account. But OAuth only authorizes MC accounts the
  connected Google login can access — if it found none, the merchant must use a
  service-account key, which was hidden. Worse, feed sync called `getAccessToken` which,
  under `oauth`, returns the OAuth token and **ignored any stored key** — so even pasting
  a key wouldn't work.
- **Fix (backend):** new `GoogleAuthService.getGmcAccessToken(merchantId)` — prefers a
  stored GMC service-account key if present, else falls back to `getAccessToken`. Feed
  sync (`feed-sync.service.ts` context) now uses it. This enables a hybrid: OAuth for
  general access + a service-account key for GMC when OAuth can't reach it.
- **Fix (UI):** the green note + key-hiding now gate on `oauthGmcActive = isOAuth &&
  !!gmcMerchantId` (a resolved Merchant ID = OAuth GMC actually works). OAuth-connected
  but no Merchant ID (nothing found) → shows the Service Account Key field + Test
  connection + the "No Merchant Center account found" info note.
- **Definition of done:** `pnpm verify` green (198 passing + 2 todo). Tests: `google-auth.gmc-token.test.ts` (key-preferred vs fallback) + extended `config.discover.test.tsx` (key field shown when OAuth + nothing found).
- **Files:** `apps/backend/src/modules/google/{google-oauth/google-auth.service.ts,gmc/feed-sync.service.ts}`, `apps/admin-google/src/routes/config.tsx`, + tests.

### 2026-06-17 — UX — Auto-save detected IDs + "nothing found" notes (follow-up)
- **Auto-save:** discovery no longer only pre-fills — when it finds **exactly one** GA4
  stream / GMC account for an **empty** field, the config route now persists it via the
  existing `update.mutate` (PUT) so the merchant doesn't have to click Save. Built from
  `configToInput(data)` (omits the write-only key); runs once per connect (`autoSavedRef`);
  multiple candidates still use the picker (no auto-save); a saved value is never
  overwritten. Enable flags are NOT auto-toggled (avoids surprise catalog sync — merchant
  ticks Enable to activate).
- **Nothing-found notes:** each section now receives its discovery sub-result; on return
  from connect it shows an **info** Alert when discovery ran and found 0 ("No GA4 property
  / Merchant Center account found — enter manually…") and a **warning** Alert if that
  integration's discovery errored.
- **Definition of done:** `pnpm verify` green (196 passing + 2 todo). Tests added for
  auto-save PUT + nothing-found notes in `config.discover.test.tsx`.
- **Files:** `apps/admin-google/src/routes/config.tsx`, `apps/admin-google/src/routes/config.discover.test.tsx`.

### 2026-06-17 — fix + UX — OAuth connect flow + GMC OAuth UX (follow-ups to auto-discovery)
- **Connect-flow bug:** the `connect` endpoint did a header-less 302, but it's behind
  `GoogleMerchantTokenGuard` (header-only: `Authorization: Bearer`/`X-Merchant-Id`, no
  query fallback). A top-level browser navigation can't send those headers → it always
  401'd `MISSING_MERCHANT_SESSION`. Fix: `connect` now **returns the consent URL as
  JSON**; admin `startGoogleConnect()` fetches it via `api` (Bearer header attached),
  then `window.location.href = url` → only the navigation to **Google** is header-less
  (merchant id rides in `state`). Both Connect (config) + Reconnect (dashboard) buttons
  use `onClick`, not `href`. Verified live (Merchant ID auto-filled post-connect).
- **GMC OAuth UX:** GMC feed sync uses the OAuth token (`feed-sync.service.ts` →
  `getAccessToken`, which returns the OAuth token with `content` scope), so the
  service-account key is NOT needed when connected via OAuth. The config form now hides
  the Service Account Key + key-based Test connection for `connectionMethod === 'oauth'`
  and shows a "Authorized via your connected Google account" note. Connect-card copy:
  not-connected mentions GA4+GMC auto-fill; connected state says GA4+GMC auto-filled but
  **Ads Conversion ID + Label stay manual** (can't be auto-detected without a dev token).
- **Multiple candidates:** exactly one GA4 stream / GMC account → auto-filled; >1 → a
  Select chooser (no auto-pick); 0 → blank. Empty fields only — never clobbers a saved value.
- **Definition of done:** `pnpm verify` green (194 passing + 2 todo). No new env, no migration.
- **Files:** `apps/backend/src/modules/google/google-oauth/google-oauth.controller.ts`, `apps/admin-google/src/{lib/oauth.ts,routes/config.tsx,routes/index.tsx}`, + tests (`google-connect.controller.test.ts`, `config.discover.test.ts`).

### 2026-06-17 — feature — GA4 + GMC auto-discovery after OAuth connect
- **What:** After a merchant connects their Google account, the admin auto-fills the
  GA4 Measurement ID and GMC Merchant ID instead of requiring manual entry. New
  `Ga4AdminClient` (`ga4/ga4-admin.client.ts`) reads web-stream Measurement IDs via
  the GA4 Admin API (`accountSummaries` → `dataStreams` → `WEB_DATA_STREAM`); new
  `ContentApiClient.getAuthinfo()` reads GMC account IDs (`accounts/authinfo`). A
  `DiscoveryService` (`discovery/discovery.service.ts`) ties them together —
  **OAuth-only** (manual/service-account path returns empty + a reason) and
  **partial-tolerant** (a GA4 failure still returns GMC results and vice-versa) —
  exposed as `GET google/api/discover` (guarded, `@CurrentMerchant`). The OAuth
  callback now redirects to `${adminBase}/config?connected=1`; the config route reads
  that flag, calls `useDiscover`, and pre-fills **only empty** fields (dropdown when
  >1 candidate, never clobbers a saved value, no auto-save — merchant reviews + Saves).
  **Ads stays manual** (Google Ads API needs a developer token — option B, deferred).
- **Why:** OAuth already grants `analytics.edit` + `content` scopes, but the callback
  only stored tokens + email; merchants still typed IDs by hand. PRD always intended
  "select GA4 property / Ads account / GMC account" on connect.
- **Setup (no new env):** reuses `RATIO_GOOGLE_GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`
  + `RATIO_GOOGLE_ADMIN_BASE_URL`. One OAuth client serves all merchants; each
  merchant's tokens are stored per `merchant_id` (`state` carries the id). Google
  Cloud: enable Analytics Admin API + Content API for Shopping; consent screen in
  Testing with the tester's email; redirect URI `…/google/api/v1/google-oauth/callback`.
- **Definition of done:** `pnpm verify` green (192 passing + 2 todo); no DB migration,
  no new env. Discovery never logs tokens.
- **Files:** `apps/backend/src/modules/google/{ga4/ga4-admin.client.ts,gmc/content-api.client.ts,discovery/discovery.service.ts,config/config.controller.ts,google.module.ts,google-oauth/google-oauth.controller.ts}`, `packages/shared/src/schemas/google-config.ts`, `apps/admin-google/src/{hooks/useDiscover.ts,lib/queryKeys.ts,routes/config.tsx}`, + tests.
- **Links:** `docs/agent/changes/ga4-gmc-autodiscovery/{SPEC,PLAN}.md`.

### 2026-06-17 — refactor (UI) — Responsive admin + equal-height dashboard cards
- **What:** Made the `admin-google` SPA usable down to ~360px and evened out the
  dashboard. `routes/index.tsx`: the three dashboard `Card`s (GA4 / Google Ads /
  Merchant Center) get `style={{ height: '100%' }}` so they render equal-height
  3-across (antd `Col`s stretch in the flex `Row`) and stack clean full-width on
  mobile; Merchant Center action buttons → `<Space wrap>`. `routes/feed.tsx`: the
  feed `Table` gets `scroll={{ x: 'max-content' }}` (horizontal scroll within the
  card, not a card-stack) and the filter `Select` → `width:'100%', maxWidth:220,
  minWidth:140`. `ScriptTagPanel.tsx` (google + `_template`): the install snippet
  `<Typography.Text code>` gets `wordBreak:'break-all'` so the long SDK URL wraps.
  `index.css`: defensive `.ant-card-body .ant-typography code { word-break:break-word;
  white-space:normal }` so no inline-code token forces page-wide overflow.
- **Why:** SPA was desktop-oriented; cards looked ragged 3-across (uneven height),
  the feed table + long install URLs overflowed the viewport on phones.
- **Definition of done / fix:** layout/CSS-only, no backend/API/schema, behavior
  unchanged. `pnpm verify` green (182). Navbar mobile Drawer (≤720px) and the
  `.container` ≤600px query were already in place and untouched.
- **Files:** `apps/admin-google/src/{routes/index.tsx,routes/feed.tsx,components/ScriptTagPanel.tsx,index.css}`, `apps/_template-admin/src/components/ScriptTagPanel.tsx`.
- **Links:** `docs/agent/changes/admin-responsive/{SPEC,PLAN}.md`.

### 2026-06-11 — feature — Single `google-ratio` pixel + real storefront install UX
- **What:** `static/google-pixel.js` now registers ONE `google-ratio` pixel (wires GA4 + Ads internally from the prelude) instead of two (`ga4`/`google-ads`). Admin dashboard dropped the "Pending API" badge → shows Configured/Not-configured from `ga4Enabled`/`adsEnabled`. `ScriptTagPanel` shows the real install: `<Script src=".../google/sdk/<merchantId>.js" strategy="afterInteractive" />` in `layout.tsx` + `"google-ratio": {}` in `pixelConfig.ts`. `_template` admin ScriptTagPanel updated to the generic `<slug>-ratio` equivalent.
- **Why:** "Pending API" (Web-Pixels-API auto-register status) was unwanted/confusing; the two `ga4`/`google-ads` registration names collided with the storefront's legacy pixelConfig keys; install instructions were wrong (`<head>` vs `layout.tsx`).
- **Definition of done / fix:** one `google-ratio` registration (GA4 isolated:false + Ads send_to + enhanced user_data, no double-count); no pixel-status surface in the admin; install panel shows the 2-step layout.tsx + pixelConfig method. `pnpm verify` green (182). Backend pixel-status columns/service left dormant (UI-only decision).
- **Files:** `apps/backend/static/google-pixel.js`, `apps/admin-google/src/routes/index.tsx`, `apps/admin-google/src/components/ScriptTagPanel.tsx`, `apps/_template-admin/src/components/ScriptTagPanel.tsx`, + tests (`google-pixel.test.ts`, `index.test.tsx`).
- **Links:** `docs/agent/changes/pixel-install-ux/{SPEC,PLAN}.md`.

### 2026-06-08 — feature — Google app built (backend + admin + SDK)
- **What:** GA4 + Ads pixels, GMC feed sync (Content API client, product-mapper, feed-sync, reconcile), Google OAuth + manual service-account, 4 webhook handlers, enhanced conversions; admin SPA; shared `google-config`.
- **Why:** Ratio parity with Shopify's Google & YouTube app.
- **Definition of done / fix:** `pnpm verify` green (182 tests); local smoke test passes (`/ready` google:ok, `/google/api/*` with `dev-merchant`).
- **Files:** `apps/backend/src/modules/google/**`, `apps/admin-google/**`, `packages/shared/src/{schemas/google-config,constants/google-events}.ts`.
- **Links:** `docs/agent/apps/google/{PRD,TRD,TDD}.md`; ADR 0001.

### 2026-06-08 — fix — Backend env not loading under `nest start`
- **What:** Backend booted with all env vars undefined.
- **Why:** `main.ts` `dotenv/config` resolves `.env` against cwd (`apps/backend`), but the `.env` is at repo root.
- **Definition of done / fix:** Added symlink `apps/backend/.env → ../../.env`; also added `emptyAsUndefined()` in `env.schema.ts` so blank optional `RATIO_GOOGLE_GOOGLE_*` keys validate.
- **Files:** `apps/backend/.env` (symlink), `apps/backend/src/config/env.schema.ts`.
- **Links:** learnings.md (dotenv cwd note).
