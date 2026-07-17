# @ratio-app/delhivery-sdk

Storefront SDK for **Delhivery Direct** — **serviceability at checkout**. This
is NOT a search SDK: there is no overlay, no results page, no recent-searches
store. It wraps exactly one PUBLIC backend endpoint:

```
GET {apiBase}/delhivery/api/serviceability?merchantId=<id>&pincode=<pin>[&order_value=<n>][&cod=true|false]
→ { serviceable, cod_available, edd_min, edd_max, carrier, degraded? }
```

The endpoint is unauthenticated (`Access-Control-Allow-Origin: *`); the caller
identifies the store via `merchantId`. **No secrets ship in any bundle** — the
merchant's Delhivery token stays on the backend, which proxies the carrier
call (6h cache, fail-open).

## Install on a storefront

The backend serves a per-merchant loader (prelude + IIFE):

```html
<script src="https://<backend>/delhivery/sdk/<merchantId>.js" defer></script>
```

The prelude sets `window.__DELHIVERY__ = { merchantId, version }`; the loader
derives `apiBase` from its own script origin.

## Primary integration — headless client (Kwik Checkout)

```js
const verdict = await window.RatioDelhivery.checkServiceability('110001', {
  orderValue: 1499, // optional
  cod: true,        // optional
});
// { serviceable: true, cod_available: true, edd_min: 2, edd_max: 5, carrier: 'DELHIVERY' }
```

- Invalid PINs (not `[1-9][0-9]{5}`) reject client-side with a
  `DelhiveryClientError` (status 400) before any network call.
- A new check aborts the previous in-flight one (PIN typing).

## Optional widget

```html
<delhivery-serviceability></delhivery-serviceability>
```

The loader lazily injects the ESM widget bundle only when the element is used
(checked at boot + `DOMContentLoaded`; SPAs that render it later call
`window.RatioDelhivery.loadWidget()`). The component renders a PIN input +
result (EDD band, COD badge) and emits a composed, bubbling `serviceability`
`CustomEvent<{ pincode, result }>` on every successful check. Config falls
back to `window.__DELHIVERY__`; override per element with `merchant-id` /
`api-base` attributes. Theme via `--dlv-primary` / `--dlv-radius` custom
properties.

## Bundles / budgets

- `dist/delhivery-loader.js` — IIFE, ≤ 3 KB (headless client + lazy injector).
- `dist/delhivery-widget.js` — ESM Lit component, ≤ 10 KB.

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm size
```
