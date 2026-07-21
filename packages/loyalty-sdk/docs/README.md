# `@ratio-app/loyalty-sdk` — QR claim widget

The storefront-side half of the loyalty app's QR claim flow
(`docs/agent/apps/loyalty/TRD.md` §2b). Two bundles, served by the backend at
`/loyalty/sdk/*` (CORS `*`, memoized — see
`apps/backend/src/modules/loyalty/storefront/storefront.controller.ts`):

| Bundle | Format | Budget | Purpose |
|---|---|---|---|
| `loyalty-loader.js` | IIFE | 4 KB | dependency-free bootstrap; publishes `window.RatioLoyalty` |
| `loyalty-claim.js` | ESM | 12 KB | Lit 3 `<loyalty-claim-widget>` (Shadow DOM), lazy-injected by the loader |

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
  merchantId: NEXT_PUBLIC_MERCHANT_ID_SDK, // optional — defaults to ?store= on the script src
  apiBaseUrl: NEXT_PUBLIC_LOYALTY_API_BASE_URL, // optional — defaults to the script src origin
});
// containerId string ⇒ inline mount; null ⇒ overlay appended to <body>.
// cleanup() unmounts the widget.
```

## Backend endpoints the widget calls

- `GET {apiBase}/loyalty/sdk/config/{merchantId}` → `{programName, enabled, version}`
- `GET {apiBase}/loyalty/qr/{code}/status` → `{state, eventName, points, programName, claimMessage?}`
- `POST {apiBase}/loyalty/qr/{code}/claim` `{gkAccessToken}` →
  `credited | already_claimed | unavailable | invalid_session`

The body carries ONLY the KwikPass token — the backend resolves the verified
phone; a client phone is never sent. Types come from
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
