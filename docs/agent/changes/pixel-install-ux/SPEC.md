# Pixel install UX: drop "Pending API", single `google-ratio` pixel + real storefront install — spec

- **Slug:** pixel-install-ux   **Type:** feature   **Size:** small
- **Area:** google app — admin UI + `static/google-pixel.js` + reference `_template` admin + tests

## Problem / goal
The admin shows a yellow **"Pending API"** badge (the Web-Pixels-API auto-registration
status). The owner doesn't want that surfaced. The real, working install is a
**hosted per-merchant script tag** the merchant adds to the storefront's Next.js
`layout.tsx` (like the existing `posthog/sdk/...js` line), with the SDK activated
via a `pixelConfig.ts` entry. Two problems today:
1. The dashboard surfaces the `pending_api` pixel-registration status (confusing, unwanted).
2. Our hosted bundle self-registers as **two** pixels named `ga4` + `google-ads` —
   which collide with the storefront's legacy `ga4`/`google-ads` `pixelConfig` keys
   (double-fire risk), and the existing `ScriptTagPanel` instruction is wrong
   ("paste into `<head>`" + an unused `"google-ratio": {}` note).

Goal: remove the "Pending API" surface; make our bundle register a **single
`google-ratio` pixel** (GA4 + Ads internally, sharing `gtag`); and fix the admin's
install instructions to the real storefront method.

## Approach
1. **`static/google-pixel.js`** — register **one** pixel `{ name: 'google-ratio', register(analytics) }`
   instead of two. Inside `register`, read `window.__GOOGLE_RATIO_CONFIG__` and wire
   GA4 (when `cfg.ga4`, `isolated:false`) and Google Ads (when `cfg.ads`, `send_to`,
   enhanced-conversions `user_data`) — same mapping/behavior as today, just under one
   registration. Register (or queue) it once when `cfg.ga4 || cfg.ads`.
2. **Admin dashboard** (`apps/admin-google/src/routes/index.tsx`) — remove the
   `StatusTag` / `STATUS_META` / `pending_api` UI. GA4 and Ads cards show the
   configured ID + a simple **Configured / Not configured** indicator derived from
   `ga4Enabled`/`adsEnabled` (NOT the pixel-registration status). No "Pending API".
3. **`ScriptTagPanel`** (`apps/admin-google/src/components/ScriptTagPanel.tsx`) — show
   the real install: a hosted `<Script>` for `layout.tsx`, plus the `pixelConfig.ts`
   entry. Copyable. Drop "paste into `<head>`". Snippets:
   - `<Script src="<base>/google/sdk/<merchantId>.js" strategy="afterInteractive" />` (add to `app/layout.tsx`)
   - add `"google-ratio": {}` to `src/config/pixelConfig.ts` so the PixelRuntime activates it.
4. **Reference `_template` admin** — apply the same install-instruction fix to
   `apps/_template-admin/src/components/ScriptTagPanel.tsx` (generic `<slug>-ratio`
   wording + `layout.tsx` `<Script>`), so future scaffolds inherit the correct
   pattern. (`_template` is reference-only — not built/run.)
5. **Tests** — update `apps/backend/test/unit/apps/google/google-pixel.test.ts` (one
   `google-ratio` registration that wires GA4 + Ads; co-existence/no-double-count still
   holds), and the admin tests (`index.test.tsx`, `config.test.tsx`) to drop any
   `pending_api`/pixel-status assertions.

Backend stays untouched (UI-only removal per decision): the `*_pixel_status` /
`*_pixel_id` columns + `pixel-registration.service` remain dormant.

## Acceptance criteria
- [ ] No "Pending API" badge or pixel-registration status anywhere in the admin UI; the GA4/Ads cards show the ID + Configured/Not-configured from `ga4Enabled`/`adsEnabled`.
- [ ] `static/google-pixel.js` registers a **single** `google-ratio` pixel that wires GA4 (`isolated:false`) and Ads (`send_to` + enhanced `user_data`) from the prelude; registers only when GA4 or Ads is configured; one GA4 `purchase` + one Ads `conversion`, no double-count.
- [ ] `ScriptTagPanel` (google admin) shows the hosted `<Script ... strategy="afterInteractive" />` for `layout.tsx` + `"google-ratio": {}` for `pixelConfig.ts`, both copyable; no `<head>` wording.
- [ ] `_template` admin `ScriptTagPanel` updated to the generic equivalent (`<slug>-ratio`).
- [ ] Tests updated (`google-pixel.test.ts` → `google-ratio`; admin tests drop pixel-status); `pnpm verify` is green.
- [ ] Served pixel `/google/sdk/dev-merchant.js` still works end-to-end via the harness (events reach GA4).

## Out of scope
- Removing the backend Web Pixels registration service or the `*_pixel_status`/`*_pixel_id` columns (kept dormant — decision: UI-only).
- Any deployment work.
- Changing the prelude shape (still `{ ga4, ads, enhancedConversions }`).

## Context consulted
- Storefront example (`wellversed-2.0` `layout.tsx` + `pixelConfig.ts`): hosted SDKs added as `<Script strategy="afterInteractive">` + a `pixelConfig` entry keyed by the SDK name (e.g. `"posthog-ratio": {}`).
- ADR 0001 (multi-handler) and the `google` `CONTEXT.md` (pixel delivery: prelude + `static/google-pixel.js`; Web Pixels API is Draft → was shown as `pending_api`).
- Existing `apps/admin-google/src/components/ScriptTagPanel.tsx` + `routes/install.tsx` (install route already exists).
