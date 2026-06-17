# meta — context

Living context for the Meta app (Facebook Pixel + Conversions API + Catalog Sync). Read before touching
this module. Standing context first; dated change journal below (newest first).

## Standing context
- **Two delivery paths.** Client-side Facebook Pixel (`static/meta-pixel.js`, served at
  `/meta/sdk/:merchantId.js`) for browser events; server-side Conversions API (CAPI)
  for server-to-Meta event forwarding.
- **Pixel config is DB-driven**, injected as a `window.__META_RATIO_CONFIG__` prelude
  before the `static/meta-pixel.js` bundle.
- **CAPI calls go direct** — `CapiService` POST to
  `https://graph.facebook.com/v21.0/{pixelId}/events` with the `access_token` in body
  (Meta's convention). PII is SHA-256-hashed before transmission.
- **Phase 2: Catalog Sync.** `CatalogService` + `CatalogBatchService` +
  `CatalogTransformerService` handle product feed sync to Meta Catalog via the Commerce
  Manager API. Redis (`RedisService`) backs the cache layer. `FeedController` exposes the
  RSS/XML feed endpoint for Meta to pull.
- **CAPI stats controller** (`CapiStatsController`) exposes per-merchant event delivery
  metrics for the admin SPA.
- **Secrets:** `capiAccessToken` and `catalogAccessToken` are **encrypted at rest** via
  `META_CRYPTO` (`CryptoService`); config GET never returns the raw token — only a
  masked presence flag; the SDK prelude strips the CAPI token before reaching the
  browser.
- **Webhook topics (slash-form):** `products/create`, `products/update`,
  `products/delete`, `app/uninstalled`. Product webhook handler is in
  `webhooks/product-webhook.controller.ts`; signature guard in
  `webhooks/ratio-signature.guard.ts`.
- **OAuth install:** standard Ratio OAuth callback → `MetaBootstrap.run()` seeds
  `meta_configs` row (INSERT … ON DUPLICATE KEY UPDATE, no-op self-update on reinstall
  to preserve credentials).
- **Local dev:** dummy merchant id `dev-merchant` seeded in `meta_app`; open the admin
  at `/?merchant-id=dev-merchant`.

## Change journal

### 2026-06-17 — monorepo merge (task-7)
- Context file created during consolidation of per-vendor agent docs into the unified
  `ratio-apps` repo. Source repo (`meta-g4_ratio_app`) had no `docs/agent/apps/meta/`
  directory; context synthesized from source TRDs, module code, and bootstrap files.
- **Files:** `docs/agent/apps/meta/CONTEXT.md`, `docs/agent/apps/meta/STATE.json`.
