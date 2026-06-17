# moengage — context

Living context for the MoEngage app (customer engagement platform — push, in-app, and web analytics). Read before touching this module. Standing context first; dated change journal below (newest first).

## Standing context
- **Single delivery path.** Client-side SDK (`static/moengage-pixel.js`, served at
  `/moengage/sdk/:merchantId.js`) initializes MoEngage Web SDK on the storefront.
- **Pixel config is DB-driven**, injected as a `window.__MOENGAGE_RATIO_CONFIG__` prelude
  before the pixel bundle. Config includes `appId`, `dataCenter`, `debug`, `swPath`,
  and `events`.
- **Data centers:** `DC_1` (US), `DC_2` (EU), `DC_3` (India), `DC_4` (Indonesia), `DC_5` (region unassigned in code).
  Default is `DC_1`. Must match the merchant's MoEngage account region.
- **Service-worker path (`swPath`):** MoEngage Web Push requires a service worker at the
  root of the domain (`/moengage-service-worker.js`). Merchants must self-host it;
  `swPath` configures the path for the SDK init call.
- **Event names are Title-Case** (e.g. `Page Viewed`, `Product Clicked`). This is
  MoEngage's convention; `buildDefaultEventMap('moengage')` in shared produces Title-Case
  names. Admins can still rename events via the events PUT endpoint.
- **Config schema:** `MoEngageConfig` from `packages/shared/src/schemas/moengage-config.ts`.
  Fields: `appId`, `dataCenter`, `debug`, `swPath`, `events`.
- **Webhook topics (slash-form):** `app/uninstalled` (handled in
  `webhooks/app-uninstalled.handler.ts`). No product webhooks.
- **OAuth install:** standard Ratio OAuth callback → `MoengageBootstrap.run()` seeds
  `moengage_configs` row (INSERT … ON DUPLICATE KEY UPDATE, no-op self-update on
  reinstall to preserve credentials). Default `dataCenter` = `'DC_1'`.
- **No encryption needed** — MoEngage App ID is not a write-secret; stored plaintext.
  No `CryptoService` injection.
- **Local dev:** dummy merchant id `dev-merchant` seeded in `moengage_app`; open the
  admin at `/?merchant-id=dev-merchant`.

## Change journal

### 2026-06-17 — monorepo merge (task-7)
- Context file created during consolidation of per-vendor agent docs into the unified
  `ratio-apps` repo. No source repo for moengage existed separately; context
  synthesized from module code and bootstrap files in the unified repo.
- **Files:** `docs/agent/apps/moengage/CONTEXT.md`, `docs/agent/apps/moengage/STATE.json`.
