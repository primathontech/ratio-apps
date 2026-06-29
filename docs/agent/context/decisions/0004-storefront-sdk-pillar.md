# 0004 — Storefront SDK as an opt-in third pillar (direct-to-vendor, separate bundles)

- **Date:** 2026-06-26
- **Status:** accepted

## Context

The `wizzy` app pushes a merchant's catalog to Wizzy's hosted search; the
remaining piece is the **storefront search experience** (autocomplete overlay +
faceted results page) on the Ratio/merchant storefront. Wizzy's ScriptTag
auto-injection API is still Draft (`pending_api`), so we needed a way to ship the
storefront widget now. The four existing vendors (google/meta/posthog/moengage)
are analytics/ads integrations with **no** storefront search UI, so a storefront
SDK is not universal.

Key facts that shaped the design:
- Wizzy's search/autocomplete endpoints (`api.wizsearch.in/v1`) are **public**:
  auth is `x-store-id` + a **public** `x-api-key` only (the store secret is
  explicitly forbidden on public endpoints), and CORS is wildcard.
- The SDK runs on arbitrary storefronts, so it must be tiny and dependency-free
  (size budget: loader ≤3KB, widget ≤10KB, results ≤16KB, enforced by size-limit).

## Decision

1. **Build a self-contained embeddable SDK** (`packages/wizzy-sdk`,
   `@ratio-app/wizzy-sdk`) in **Lit 3 + Vite library mode**. The merchant pastes
   one `<script src=".../wizzy/sdk/wizzy-loader.js?store=<merchantId>">`. The
   loader (classic IIFE) fetches public config, lazy-injects the **overlay** ESM
   bundle on first focus, and injects the **results-page** ESM bundle on the
   results route.
2. **Direct browser → vendor** for search/autocomplete (no backend proxy on the
   hot path), because the endpoints are public and browser-safe — lowest latency,
   no backend load per keystroke. The backend only serves the bundles + a
   redacted public `config/:merchantId` (never the secret).
3. **Type-only shared-schema imports** in the SDK so Zod is **not** bundled
   (would blow the 10KB budget). Runtime validation stays on the backend.
4. **Overlay and results page are SEPARATE bundles**, not one bundle with a
   dynamic chunk — keeps the always-loaded overlay small; the loader pulls the
   heavier results bundle only on the results route.
5. **Promote "storefront SDK" to an opt-in third architecture pillar** (alongside
   the backend module + admin SPA), gated by a `hasStorefrontSdk` flag. Golden
   source `packages/_template-sdk/` (workspace+biome excluded, like other
   `_template`s). `wizzy` is the first opt-in; the analytics apps stay `false`.

## Rationale

- A backend proxy was considered and rejected: it adds a hop + backend load on
  every keystroke for endpoints that are public by design (nothing secret is
  exposed). Loading Wizzy's own hosted SDK via ScriptTag was blocked (Draft API).
- Lit 3 makes Shadow DOM isolation the foundation (not a workaround), which an
  embeddable widget needs so storefront CSS can't break it and vice-versa.
- Making the SDK mandatory for every app would produce dead code for the four
  analytics vendors; opt-in keeps the pillar real without bloating them.

## Consequences

- New apps with a storefront search/discovery surface set `hasStorefrontSdk` and
  get `packages/<slug>-sdk` scaffolded from `_template-sdk` (vendor-scaffolder),
  with backend `/<slug>/sdk/*` serving routes; the deploy artifact must serve
  those bundles.
- The public `x-api-key` is exposed in the browser by design (it is public);
  the store **secret** must never be sent or returned (enforced by an allow-list
  + `.strict()` schema on the config endpoint).
- Bundle size is a standing constraint — keep Zod and other heavy deps out of the
  SDK graph (type-only imports); size-limit gates it in CI.
- Playwright E2E for the SDK must run serially (shared static server + shared
  `page.route` patterns flake under parallel workers).
