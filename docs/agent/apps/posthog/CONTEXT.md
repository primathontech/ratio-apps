# posthog — context

Living context for the PostHog app (product analytics + event tracking). Read before touching
this module. Standing context first; dated change journal below (newest first).

## Standing context
- **Single delivery path.** Client-side SDK (`static/posthog-pixel.js`, served at
  `/posthog/sdk/:merchantId.js`) captures storefront events and sends them to PostHog
  via the PostHog JS library.
- **Pixel config is DB-driven**, injected as a `window.__POSTHOG_RATIO_CONFIG__` prelude
  before the pixel bundle. Config includes `apiKey`, `host`, `debug`, and `events`.
- **Default host is `DEFAULT_POSTHOG_HOST`** (US Cloud: `https://us.i.posthog.com`).
  EU-hosted merchants set their own `host`.
- **No server-side event forwarding.** Unlike Meta/MoEngage, PostHog events go
  browser-to-PostHog directly. The backend SDK service only renders the per-merchant
  JS prelude + pixel file.
- **Config schema:** `PostHogConfig` from `packages/shared/src/schemas/posthog-config.ts`.
  Fields: `apiKey` (PostHog project API key), `host`, `debug`, `events` (event-name map).
- **Webhook topics (slash-form):** `app/uninstalled` (handled in
  `webhooks/app-uninstalled.handler.ts`). No product webhooks.
- **OAuth install:** standard Ratio OAuth callback → `PosthogBootstrap.run()` seeds
  `posthog_configs` row (INSERT … ON DUPLICATE KEY UPDATE, no-op self-update on
  reinstall to preserve credentials). Default `host` = `DEFAULT_POSTHOG_HOST`.
- **No encryption needed** — PostHog API key is not a write-secret; stored plaintext
  (unlike Meta's CAPI token). No `CryptoService` injection.
- **Local dev:** dummy merchant id `dev-merchant` seeded in `posthog_app`; open the
  admin at `/?merchant-id=dev-merchant`.

## Change journal

### 2026-06-17 — monorepo merge (task-7)
- Context file created during consolidation of per-vendor agent docs into the unified
  `ratio-apps` repo. Source repo (`posthog/`) had no `docs/agent/` directory; context
  synthesized from module code and bootstrap files.
- **Files:** `docs/agent/apps/posthog/CONTEXT.md`, `docs/agent/apps/posthog/STATE.json`.
