# `@ratio-app/loyalty-sdk` — QR claim widget

The storefront-side half of the loyalty app's QR claim flow
(`docs/agent/apps/loyalty/TRD.md` §2b). Two bundles, served by the backend at
`/loyalty/sdk/*` (CORS `*` — see
`apps/backend/src/modules/loyalty/storefront/storefront.controller.ts`):

| Bundle | Format | Budget | Purpose | Cache |
|---|---|---|---|---|
| `loyalty-loader.js` | IIFE | 4 KB | dependency-free bootstrap; publishes `window.RatioLoyalty` | `no-cache` (unversioned URL) |
| `loyalty-claim.js` | IIFE | 12 KB | Lit 3 `<loyalty-claim-widget>` (Shadow DOM), lazy-injected by the loader | `immutable` (URL carries `?v=<SDK_VERSION>`) |

Both bundles are **classic IIFE** scripts (no `type="module"`): a classic
cross-origin script loads no-cors and survives storefront service workers that
mishandle cross-origin module fetches.

## Identity & trust boundary (v2)

The browser talks **only to its own (storefront) origin**. It never sends a
phone and never calls our backend directly:

```
widget ──(same-origin)──► storefront BFF /api/loyalty/*
                                │  resolves verified phone from KwikPass token,
                                │  HMAC-signs ${merchantId}.${qr}.${phone}.${ts}
                                ▼
                          our backend /loyalty/qr/{code}/claim  (verify sig → credit)
```

KwikPass/GoKwik live entirely in the storefront BFF (see the `wellversed-2.0`
`LoyaltyClaim` widget + `src/app/api/loyalty/*` routes). Our backend holds only
the per-merchant signing secret and verifies the signature — zero KwikPass.

## Snippet (non-Shopkit storefronts)

```html
<script src="https://{backend}/loyalty/sdk/loyalty-loader.js?store={merchantId}"></script>
```

When the page URL carries `?loyalty_qr={code}` and no wrapper claims init
within a tick, the loader self-inits in overlay mode. Without the param the
loader is zero-cost: no bundle fetch, no API call.

## Programmatic API (Shopkit wrapper)

```ts
const cleanup = window.RatioLoyalty.initClaim(containerIdOrNull, {
  // Both optional. apiBaseUrl ONLY redirects where the CLAIM BUNDLE is fetched
  // from (still cross-origin, our backend); it does NOT change the widget's own
  // API base, which is always the page origin. merchantId is accepted for
  // back-compat but no longer consumed — the storefront BFF resolves the merchant.
  merchantId,
  apiBaseUrl,
});
// containerId string ⇒ inline mount; null ⇒ overlay appended to <body>.
// cleanup() unmounts the widget.
```

## Endpoints the widget calls (same-origin storefront BFF)

- `GET  {origin}/api/loyalty/status?qr={code}` → `{state, eventName, points, programName, claimMessage?}`
- `POST {origin}/api/loyalty/claim` `{qr, gkAccessToken}` →
  `credited | already_claimed | unavailable | invalid_signature`

`{origin}` is `window.location.origin` — the merchant storefront's own BFF. The
POST body carries only the QR code and the KwikPass token; the BFF resolves the
verified phone and signs the request to our backend. A phone is never sent from
the browser. The BFF returns **clean JSON** — never the backend's
`{status_code, message, data}` envelope. Response types come from
`@ratio-app/shared/schemas/loyalty-claim` (imported **type-only** — no Zod in
the browser bundles).

## Event bridge (window `CustomEvent`s)

| Event | Direction | Detail |
|---|---|---|
| `loyalty:login:request` | SDK → host | none — host should open KwikPass login (`window.handleCustomLogin(false)` is also called directly as fallback) |
| `user-loggedin` | KwikPass → SDK | claim resumes when this fires |
| `loyalty:claim:success` | SDK → host | `{code, points, newBalance, programName}` |
| `loyalty:claim:error` | SDK → host | `{code, reason}` |

## KwikPass session

`src/kwikpass.ts` centralizes every KwikPass fact: token keys
(`KWIKUSERTOKEN`, `SANDBOXKWIKUSERTOKEN`, `QAKWIKUSERTOKEN`,
`DEVKWIKUSERTOKEN` — cookie first, then localStorage, mirroring wellversed-2.0
`src/integrations/kwikpass-custom/utils.tsx`), the login trigger, and the
resume event. A KwikPass rename is a one-file change here.
</content>
</invoke>
