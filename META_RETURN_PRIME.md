# Meta & Return Prime Integrations

Two merchant-facing apps built on the Ratio App Ecosystem, each solving a problem created by running on a custom (non-native-Shopify) commerce stack: merchants lose out-of-the-box access to standard Shopify-app integrations, so we rebuilt the bridge ourselves.

---

## 1. Meta (Facebook Pixel + Conversions API + Catalog Sync)

**Status:** built, local-tested (not yet deployed)

### What we built
- A self-serve admin app where a merchant connects their Facebook Pixel + Conversions API (CAPI) access token — no manual dev work per merchant.
- **Client-side tracking**: a per-merchant Pixel script (`/meta/sdk/:merchantId.js`) that the storefront loads, config-driven from the DB (pixel ID, event settings) — no hardcoded merchant values.
- **Server-side tracking (CAPI)**: events are forwarded directly to Meta's Graph API from our backend, not just the browser. Personal data (email, phone) is SHA-256-hashed before it ever leaves our servers.
- **Reliability layer**: CAPI events are queued (AWS SQS) and dispatched in batches by a background worker, so a Meta API hiccup doesn't drop events or block checkout.
- **Catalog Sync (Phase 2)**: product feed automatically kept in sync with Meta's Commerce Manager (create/update/delete webhooks + a pull-based feed endpoint), so merchants don't have to hand-manage their product catalog for ads.
- **Security**: access tokens are encrypted at rest and never exposed to the browser or returned by the API — only a "connected" flag.
- A stats view showing each merchant their own event delivery numbers.

### Why it matters
- **Better ad performance**: server-side CAPI events aren't blocked by ad-blockers or iOS tracking restrictions the way browser-only Pixel tracking is — merchants get more complete, more accurate conversion data, which directly improves Meta's ad-targeting/optimization and lowers cost-per-acquisition.
- **Retargeting without manual work**: catalog sync means dynamic product ads and retargeting "stay fresh" automatically as merchants add/change/remove products.
- **Zero engineering lift per merchant**: any merchant on the platform can connect their own Pixel/catalog in minutes, self-serve — this used to require a bespoke integration per store.
- **Safe by default**: hashing + encryption means we can offer this without creating a PII liability.

---

## 2. Return Prime (Returns & Exchange Management)

**Status:** built (backend module `rp` + `admin-rp` config app)

### The problem
Return Prime is a returns/exchange-automation product built to talk to **Shopify's Admin API**. Our merchants run on GoKwik's custom order/checkout backend ("OS") instead of native Shopify, so Return Prime can't talk to them directly — there's no orders/refunds/discounts API in the shape it expects.

### What we built
A full **Shopify-Admin-API-compatible adapter layer** that sits between Return Prime and our real backend (GoKwik OS Order Service + Ratio App Ecosystem), so Return Prime works exactly as it would on a native Shopify store:
- **Orders, refunds, customers, products, discounts** — each proxied and reshaped from our backend's format into the exact JSON shape Return Prime/Shopify expects (and back).
- **OAuth install flow** — merchants install Return Prime like any other app; we issue and store encrypted access/refresh tokens per merchant.
- **Webhooks bridge** — order/product events from our backend are translated into the Shopify-style webhook payloads Return Prime listens for.
- **Self-serve customer return portal** — a hosted portal (`/rp/customer/portal`) customers land on to request a return or exchange, no support-ticket needed.
- **Exchange discount codes** — when a customer exchanges instead of refunds, we auto-generate a discount code via the Ratio API so they can complete the swap at checkout.
- **Merchant admin app (`admin-rp`)** — a small config UI merchants use to confirm their store is registered/connected.

### Why it matters
- **Unlocks an off-the-shelf app for a non-standard stack**: without this adapter, Return Prime — and by extension automated, self-serve returns — simply isn't possible on our checkout infrastructure. This closes that gap without asking Return Prime to change anything on their end.
- **Less manual support work**: customers can request/track returns and exchanges themselves through the portal instead of emailing support.
- **Faster exchanges, less refund leakage**: auto-generated exchange discount codes nudge customers toward exchanges over refunds.
- **Reusable pattern**: this "adapter layer" approach (transform + proxy to Shopify-shaped API) is now a template for onboarding *any* other Shopify-app-ecosystem tool onto our custom backend in the future.

---

## Common thread

Both integrations exist because our merchants run on a custom commerce backend (GoKwik/Ratio) instead of vanilla Shopify, which normally cuts them off from the standard app ecosystem (Meta's own Shopify app, Return Prime's Shopify app, etc.). In both cases we rebuilt the missing bridge ourselves — one as a first-party tracking pipeline (Meta), the other as a protocol-compatibility shim (Return Prime) — so merchants get the same app-store experience as a standard Shopify merchant would.
