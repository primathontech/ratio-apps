# GA4 + GMC auto-discovery after OAuth connect — spec

- **Slug:** ga4-gmc-autodiscovery   **Type:** feature   **Size:** feature
- **Area:** backend (`apps/backend/src/modules/google`) + admin (`apps/admin-google`) + shared (`packages/shared`)

## Problem / goal
Today the "Connect Google Account" OAuth flow (`google-oauth/google-auth.service.ts`)
exchanges the code and stores encrypted tokens + the account email — **and nothing
else**. The merchant must then still type the **GA4 Measurement ID** and **GMC
Merchant ID** by hand into the config form, even though the granted scopes
(`analytics.edit`, `content`) already let us read them from Google.

The PRD always intended this (`PRD.md:139-141`: OAuth → "select GA4 property / Ads
account / GMC account"); only token storage got built. Goal: after a merchant
connects, **auto-discover and pre-fill** their GA4 Measurement ID(s) and GMC
Merchant ID(s) so they don't type them. **Ads stays manual** (the Google Ads API
needs a developer token — out of scope, option B).

## Approach

### Per-merchant OAuth model (how it works — no new env)
- **One** OAuth client (the app's single `client_id`/`secret`/`redirect_uri`) serves
  **all** merchants. Each merchant clicks Connect → consents with **their own**
  Google account → Google redirects to the single `redirect_uri` carrying
  `state=<merchantId>` → the callback stores **that merchant's** tokens in
  `google_credentials` keyed by `merchant_id`. Discovery then uses that merchant's
  token. Standard multi-tenant OAuth; **no per-merchant env**, **no new env keys**.
- Discovery is **OAuth-only**: the manual/service-account path has a Content-scoped
  token but no Analytics access, so `GET /discover` returns empty (with a reason)
  when `connection_method !== 'oauth'`.

### Backend
1. **GA4 Admin API client** — new `google/ga4/ga4-admin.client.ts` (mirrors
   `content-api.client.ts`: injected `fetchImpl`, `getAccessToken`, typed errors,
   never logs tokens). Reads web-stream Measurement IDs via the GA4 Admin API
   (`https://analyticsadmin.googleapis.com/v1beta`): `GET /accountSummaries` →
   for each `propertySummary` → `GET /{property}/dataStreams` → collect
   `WEB_DATA_STREAM` entries' `webStreamData.measurementId` (+ `displayName`).
   Bound to the first 25 properties to cap fan-out.
2. **GMC accounts** — add `getAuthinfo()` to the existing `ContentApiClient`:
   `GET ${baseUrl}/accounts/authinfo` → returns
   `accountIdentifiers: [{ merchantId, aggregatorId? }]`.
3. **Discovery service** — new `google/discovery/discovery.service.ts`: given a
   merchantId, checks `connection_method`; if `oauth`, gets the access token
   (`GoogleAuthService.getAccessToken`, already carries all granted scopes) and
   calls GA4 + GMC **independently** (each wrapped in try/catch → partial-tolerant).
   Returns `{ ga4: { streams[], error? }, gmc: { accounts[], error? } }`. Manual →
   `{ ga4: { streams: [], error: 'oauth required' }, gmc: { … } }`.
4. **Endpoint** — `GET google/api/discover` on the existing config controller
   (or a small discovery controller), `@UseGuards(GoogleMerchantTokenGuard)` +
   `@CurrentMerchant()`, returns the service result. Read-only; saves nothing.
5. **Callback redirect** — change `google-oauth.controller.ts` callback to bounce to
   `${adminBase}/config?connected=1` (instead of `/`) so the merchant lands on the
   form that auto-fills.

### Admin (auto-fill on return from connect)
6. **Shared contract** — add `googleDiscoverResponseSchema` (+ inferred type) to
   `packages/shared/src/schemas/google-config.ts`.
7. **`useDiscover` hook** — React Query `GET /google/api/discover`.
8. **Config route** — when the route loads with `?connected=1` (return from OAuth),
   call discover and **pre-fill only empty fields**: set `ga4MeasurementId` /
   `gmcMerchantId` when exactly one candidate; when multiple, render a **Select** of
   candidates (choosing fills the field) next to the input; never clobber an
   already-saved value. Show a subtle "Auto-detected from your Google account" hint
   and surface a per-section note if that integration's discovery errored. The
   merchant **reviews and clicks Save** (no auto-save). Ads section unchanged.

### Setup (documented in the change journal + here for the user)
Reuses the **existing** env (fill them in, don't add new ones):
`RATIO_GOOGLE_GOOGLE_CLIENT_ID`, `RATIO_GOOGLE_GOOGLE_CLIENT_SECRET`,
`RATIO_GOOGLE_GOOGLE_REDIRECT_URI`, `RATIO_GOOGLE_ADMIN_BASE_URL` (+ the crypto key
already used for token encryption). Google Cloud Console: enable **Google Analytics
Admin API** + **Content API for Shopping**, OAuth consent screen in Testing with the
tester's email, redirect URI = `…/google/api/v1/google-oauth/callback`.

### Alternatives rejected
- **Explicit "Detect" buttons** — predictable/re-runnable, but the user chose
  auto-on-return for a hands-off connect. (We still pre-fill only empty fields, so
  it's non-destructive.)
- **Auto-save discovered values** — rejected; pre-fill + manual Save keeps the
  merchant in control and matches the existing form.
- **Include Ads** — rejected here (needs a Google Ads API developer token); tracked
  as option B for later.

## Acceptance criteria
- [ ] `GET google/api/discover` (guarded) returns `{ ga4: { streams[], error? }, gmc: { accounts[], error? } }`; OAuth merchant gets real GA4 Measurement IDs + GMC account IDs; manual merchant gets empty lists with an `oauth required` reason.
- [ ] Discovery is **partial-tolerant**: if the GA4 call fails, GMC results still return (and vice-versa) — one integration erroring never 500s the endpoint.
- [ ] GA4 Admin client collects `WEB_DATA_STREAM` Measurement IDs across the merchant's properties; Content client `getAuthinfo()` returns the merchant's GMC account IDs. Both covered by unit tests with a faked `fetchImpl`. Tokens are never logged.
- [ ] OAuth callback redirects to `${adminBase}/config?connected=1`.
- [ ] On the config route with `?connected=1`: empty `ga4MeasurementId` / `gmcMerchantId` are pre-filled when exactly one candidate; a Select of candidates appears when multiple; an already-saved value is never overwritten; nothing is saved until the merchant clicks Save. Covered by an admin test.
- [ ] `pnpm verify` is green.

## Out of scope
- **Google Ads** discovery (Conversion ID/label) — needs a developer token (option B).
- Auto-saving discovered values; changing the manual/service-account path.
- Discovering GMC sub-settings (country/language/currency) or GA4 property *creation*.
- Any new env var, schema migration, or change to the pixel/feed-sync runtime.

## Context consulted
- `google-oauth/{google-auth.service.ts,google-oauth.controller.ts,google-oauth.http.ts}` — scopes already requested (`analytics.edit`, `content`, `adwords`); callback stores tokens + email only; `getAccessToken` returns the merchant's OAuth token (all granted scopes).
- `gmc/content-api.client.ts` — pattern to mirror for the GA4 client + home for `getAuthinfo()`.
- `config/config.controller.ts` — `@Controller('google/api')`, `GoogleMerchantTokenGuard`, `@CurrentMerchant`, per-section validate endpoints.
- `apps/admin-google/src/{routes/config.tsx,lib/oauth.ts,hooks/useConfig.ts}` — form fields (`ga4MeasurementId`, `gmcMerchantId`), `OAUTH_CONNECT_URL`, React Query patterns.
- `google` CONTEXT.md (DB-driven config; secrets encrypted; OAuth vs manual paths) + PRD.md:139-141 (OAuth "select property/account" was always intended).
