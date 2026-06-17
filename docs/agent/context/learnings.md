# Learnings (cross-cutting gotchas)

Non-obvious facts discovered while building. Newest first. Add via the `remember`
skill. Keep each entry 1–3 lines.

- **2026-06-17** — Google ID auto-discovery needs only OAuth (no extra scopes/keys): GA4 Measurement IDs come from the GA4 Admin API (`analyticsadmin.googleapis.com/v1beta` → `accountSummaries` → `{property}/dataStreams`, keep `type === 'WEB_DATA_STREAM'` → `webStreamData.measurementId`); GMC account IDs come from the Content API `accounts/authinfo` (`accountIdentifiers[].merchantId`, no merchantId in the path). Ads Conversion ID/label is NOT discoverable by OAuth alone — the Google Ads API requires a developer token (separate Google approval), so Ads stays manual.
- **2026-06-11** — Hosted app pixels register as a SINGLE `<slug>-ratio` pixel (e.g. `google-ratio`, matching `posthog-ratio`), NOT under generic names like `ga4`/`google-ads` (those collide with the storefront's legacy `pixelConfig` keys). Storefront install = add `<Script src=".../<slug>/sdk/<merchantId>.js" strategy="afterInteractive" />` to `layout.tsx` + `"<slug>-ratio": {}` in `src/config/pixelConfig.ts`; per-merchant config is served in the bundle's prelude (not env/pixelConfig).
- **2026-06-08** — Ratio product/variant prices are **integer paise**; divide by 100 for major-unit (₹) money sent to external APIs.
- **2026-06-08** — Webhook `event` strings: the platform registry uses **slash-form** (`products/create`, `app/uninstalled`). The `_template` example used dot-form; confirm against a live delivery before trusting (a wrong topic silently no-ops via the dispatcher fast-path).
- **2026-06-08** — The Web Pixels API (`POST /pixels`) is **Draft** (`codegen_ready:false`); pixel registration must degrade to a `pending_api` status, with script-tag delivery as the working fallback.
- **2026-06-08** — `nest start` runs with cwd = `apps/backend`, and `main.ts` does `dotenv/config` against `DOTENV_CONFIG_PATH='.env'` (cwd-relative); a symlink `apps/backend/.env → ../../.env` makes it load the root `.env`.
