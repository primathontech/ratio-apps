# Features registry

The catalog of capabilities in this repo and their lifecycle status. Drill into a
capability's `CONTEXT.md` for its standing context + change journal. Update the
`Status` when a capability's lifecycle changes (`building` → `built` →
`local-tested` → `pr-open` → `deployed`). Add via the `remember` skill.

| Capability | Slug | Status | Context | Notes |
|---|---|---|---|---|
| Google (GA4 + Google Ads + Merchant Center) | `google` | built · local-tested | [apps/google/CONTEXT.md](./apps/google/CONTEXT.md) | not yet PR'd/deployed; needs Web Pixels API + live Ratio token for full flow. OAuth auto-discovery built for GA4 + GMC (auto-fills IDs on connect); Ads ID/label still manual (needs Google Ads API dev token). GMC product sync hardened (2026-06-18): real webhook envelope, durable SQS `google-product-sync` queue + worker, Ratio token refresh, prices in rupees |
| Meta (Facebook Pixel + Conversions API + Catalog Sync) | `meta` | built · local-tested | [apps/meta/CONTEXT.md](./apps/meta/CONTEXT.md) | not yet PR'd/deployed; Phase 2 catalog sync present (CatalogBatchService + FeedController); CAPI token encrypted at rest; product webhooks wired |
| PostHog (product analytics + event tracking) | `posthog` | built · local-tested | [apps/posthog/CONTEXT.md](./apps/posthog/CONTEXT.md) | not yet PR'd/deployed; browser-to-PostHog direct (no server-side forwarding); EU merchants set custom host; no product webhooks |
| MoEngage (customer engagement — push, in-app, analytics) | `moengage` | built · local-tested | [apps/moengage/CONTEXT.md](./apps/moengage/CONTEXT.md) | not yet PR'd/deployed; Title-Case event names; multi-region data centers (DC_1–DC_5); service-worker path configurable; no product webhooks |
| Wizzy (AI Search & Discovery — catalog sync + storefront search SDK) | `wizzy` | built · local-tested | [apps/wizzy/CONTEXT.md](./apps/wizzy/CONTEXT.md) | not yet PR'd/deployed. Catalog sync to Wizzy (`/products/save\|delete`, bulk + hourly reconcile + SQS) + **storefront search SDK** (2026-06-26): pasted-`<script>` Lit widget — autocomplete overlay + faceted results page — calling Wizzy's public search API directly. ScriptTag auto-injection stays `pending_api`. ⚠️ verify catalog price units (paise ÷100) during integration |
| Storefront SDK pillar (opt-in) | `_template-sdk` | golden source (not shipped) | [decisions/0004](./context/decisions/0004-storefront-sdk-pillar.md) | third architecture pillar alongside backend + admin; opt-in via `hasStorefrontSdk`. Golden copy-source `packages/_template-sdk` (excluded from run/workspace); scaffolded to `packages/<slug>-sdk`. Reference impl: `packages/wizzy-sdk` |
| Golden template | `_template` | golden source (not shipped) | — | scaffolder copy source; excluded from run/workspace |
