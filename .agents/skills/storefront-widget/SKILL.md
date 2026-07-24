---
name: storefront-widget
description: The two-part pattern for putting a vendor app's UI onto a merchant storefront — the app SDK contract (window global + init API + CustomEvent bridge, served at /<slug>/sdk/*) and the Shopkit wrapper widget in the storefront repo (wellversed-2.0), modeled on the live FBT (SDK) integration. A REFERENCE skill consulted by trd-architect and frontend-builder when hasStorefrontSdk is true; not a step in the flow.
when_to_use: Consult whenever a vendor app needs UI on the merchant storefront (hasStorefrontSdk true) — designing the SDK's public API, or authoring the wrapper-widget PR in the storefront repo. Contains the storefront repo facts (paths, KwikPass login bridge, widget registry, env conventions) so you never need to re-explore the storefront codebase.
---

# Storefront widget pattern (FBT flow)

How a vendor app ships UI into a merchant storefront. Two parts, two repos:

1. **The app SDK** — `packages/<slug>-sdk` in THIS repo (golden copy-source
   `packages/_template-sdk`, build reference `packages/wizzy-sdk`), served by the
   vendor backend at `/<slug>/sdk/*`.
2. **The wrapper widget** — a Shopkit React widget in the merchant storefront
   repo (Wellversed: `wellversed-2.0`, Next.js App Router + Shopkit), modeled on
   the **live FBT (SDK) integration**. The wrapper is a separate-repo PR,
   tracked as a build deliverable but outside this monorepo's CI.

The canonical worked example of this whole flow is the **loyalty** app
(`docs/agent/apps/loyalty/TRD.md` §2b) replicating the **FBT** integration
(app repo `osapp-freq-bought`, storefront wrapper
`wellversed-2.0/src/widgets/common/FBT/`).

## Part 1 — the app SDK contract

Build per `stack-patterns` → "Storefront SDK patterns" (Lit 3 + Vite library
mode, Shadow DOM, size-limit budgets, loader + lazy ESM bundles). What THIS
skill adds is the **public API shape** the wrapper expects:

- Expose ONE window global, PascalCase-namespaced:
  `window.Ratio<Feature> = { init<Feature>(containerId: string | null, config): (() => void) | undefined }`
  — FBT precedent: `window.ProductBundler.initStandaloneFromLookup(containerId, config, sourceId)`.
  - `containerId` string ⇒ render inline into that element (wrapper provides the
    div + skeleton). `null` ⇒ overlay/modal mode (Shadow DOM, self-positioned).
  - `config` carries `{ merchantId, apiBaseUrl, … }` — never secrets; public
    creds only (a secret must never reach the browser).
  - Return a **cleanup function**; the wrapper calls it on unmount.
- **Self-init fallback**: when the loader detects its trigger condition (a query
  param like `?loyalty_qr=`, a selector, etc.) and no wrapper has called init,
  it initializes itself in overlay mode. This keeps a plain
  `<script src="{backend}/<slug>/sdk/<slug>-loader.js?store={merchantId}">`
  include working for any non-Shopkit storefront.
- **CustomEvent bridge** for anything the SDK needs from the host page. Naming:
  `<slug>:<thing>:<action>`. The SDK dispatches requests; the wrapper (or host)
  listens and responds. FBT precedent: `cart:snapshot:request` /
  `cart:snapshot`, `fbtAddToHandler` / `fbtAddToHandler:success`,
  `no_bundle_found`. Loyalty: `loyalty:login:request`,
  `loyalty:claim:success` / `loyalty:claim:error`.
- Zero cost when the trigger condition is absent (loader checks and bails).
- Type-only imports from `@ratio-app/shared` — no Zod in browser bundles.

## Part 2 — the wrapper widget in the storefront repo

Storefront: **`wellversed-2.0`** (path in dev:
`…/Ratio APPS/wizzy/wellversed-2.0`). Next.js App Router + Shopkit
(`@shopkit/core`), widget/template driven. Generator: `bun run g:widget`
(`shopkit g widget`). Copy the anatomy of the live FBT wrapper —
**`src/widgets/common/FBT/`** — file for file:

```
src/widgets/common/<Feature>/
  index.tsx        # variant dispatcher ("use client")
  types.ts         # <Feature>Props / settings interfaces
  variants.ts      # { v1: V1, default: V1 }
  V1/index.tsx     # the real wrapper (see checklist below)
```

The `V1` wrapper (reference implementation:
`src/widgets/common/FBT/V1/index.tsx`):

1. **Gate cheaply.** Derive the trigger (query param, product id from `data`,
   pathname) and `return null` when absent — the widget is mounted broadly but
   costs nothing. FBT gates on `sourceId`; loyalty gates on `?loyalty_qr=`.
2. **`loadSdkOnce()`** — module-level memoized promise that injects
   `<script src={NEXT_PUBLIC_<FEATURE>_SDK_URL}>` (resolve on `load`, reject +
   reset on `error`; reuse an existing script tag if present). Do NOT use
   `next/script` — the load must be gated on runtime state.
3. **Init + cleanup.** After load, call
   `window.<Global>.init<Feature>(containerOrNull, { merchantId, apiBaseUrl })`
   in a `useEffect`; keep the returned cleanup and call it on unmount/dep change.
4. **Skeleton (inline mode only).** Render a Tailwind skeleton; hide it when the
   container gains children (MutationObserver — see FBT V1). Overlay-mode
   widgets skip this.
5. **Event bridge.** `window.addEventListener` for the SDK's request events and
   answer them with storefront capabilities (cart store, KwikPass login —
   see below). Remove all listeners in the effect cleanup.
6. **Register** in `src/editor-integration/widget-registry.ts`: add
   `WIDGET_TYPES.<Feature>` + a registry entry (name, description, minimal
   `settingsSchema` with a `variant` select). See `WIDGET_TYPES.FBT` entry.
7. **Place** the widget:
   - Page-scoped UI (product page section, etc.) → add a section in the theme
     template, e.g. `src/themes/wellversed-2/templates/products/default.ts`
     (see the `fbt-section` entry, `dataSourceKey: "product"`).
   - Site-wide/param-triggered UI (like a QR claim overlay) → the root/layout
     level template so it exists on every page; the gate in step 1 keeps it free.
8. **Env** — add to the storefront's env set (document in its `ENV_GUIDE.md`):
   `NEXT_PUBLIC_<FEATURE>_SDK_URL` (loader URL on the vendor backend),
   `NEXT_PUBLIC_<FEATURE>_API_BASE_URL` (vendor backend base),
   reuse `NEXT_PUBLIC_MERCHANT_ID_SDK` for the merchant id.

## Storefront facts you'd otherwise have to re-discover

- **Auth = KwikPass** (GoKwik OTP login SDK), integration at
  `src/integrations/kwikpass-custom/`. Trigger login with
  **`window.handleCustomLogin(false)`** (SDK-provided global); listen for the
  **`user-loggedin`** window event to resume. Logout hard-redirects to `/`.
- **KwikPass token** lives in cookie/localStorage keys **`KWIKUSERTOKEN`**
  (+ `_SANDBOX`/`_QA`/`_DEV` variants), centralized in
  `src/integrations/kwikpass-custom/utils.tsx` (`KWIKPASS_TOKEN_KEYS`). A
  customer's verified phone is NOT client-exposed — resolve it **server-side**
  via `GET {customerApiBase}/v1/storefront/customers/profile` with headers
  `gk-access-token` + `gk-merchant-id`. **Do this in the storefront BFF, not the
  vendor backend** — see the BFF-signing pattern below.
- **No returnUrl / redirect-after-login exists** — KwikPass login is an
  in-place modal, so "resume after login" = listen for `user-loggedin`.
- **Third-party scripts** load via the `src/integrations/` pattern (dynamic
  import in `src/app/layout.tsx`, `ssr:false`) — but an app widget should use
  the wrapper-widget pattern above instead, so it is editor-visible and
  template-placeable.
- **CORS**: the vendor backend must allow the storefront origin
  (`ALLOWED_ORIGINS`) for any endpoint the SDK calls from the browser;
  `/<slug>/sdk/*` bundle+config routes are CORS `*` by convention.

## Identity-bearing widgets — the BFF-signing pattern (recommended)

When a widget's action depends on the customer's verified identity (a claim, a
redemption, anything phone-keyed), do **not** ship the KwikPass token to the
vendor backend and have the backend resolve identity. Instead keep KwikPass and
identity resolution entirely inside the storefront, and make the browser talk
**only to its own origin**:

1. **Browser → same-origin BFF.** The widget's SDK client targets
   `window.location.origin` and calls the storefront's own API routes
   (`src/app/api/<feature>/*` in Next.js App Router; `runtime = "nodejs"` so
   `crypto` is available). It sends the action payload + the KwikPass token —
   never a phone. No CORS, no ngrok, no cross-origin bundle for the API calls
   (the loader/claim *bundles* are still fetched cross-origin from `/<slug>/sdk/*`).
2. **BFF resolves identity.** The route reads the KwikPass token, resolves the
   verified phone via the GoKwik customer-profile API (headers above), and
   masks the phone in any logs.
3. **BFF signs per-merchant and forwards.** The route computes
   `sig = HMAC_SHA256(canonicalString, <FEATURE>_CLAIM_SECRET)` (hex) over a
   canonical string with a fresh `ts`, and `POST`s `{merchantId, phone, ts, sig, …}`
   to the vendor backend. The secret is **server-only** (never `NEXT_PUBLIC_*`).
4. **Vendor backend verifies only.** It recomputes the HMAC with the merchant's
   stored secret, compares **constant-time** (`crypto.timingSafeEqual`, with
   length guards), enforces a small timestamp window (e.g. ±5 min) against
   replay, and checks `body.merchantId` matches the resource's merchant. It
   imports zero KwikPass/GoKwik code. The signing string, digest encoding, and
   window must be **byte-identical** on both sides.

The vendor backend stores a per-merchant secret (generated at install, e.g.
`randomBytes(32).toString('base64')`, rotatable from the admin Settings screen;
the raw secret is never returned by any read endpoint — expose only a
`claimSecretSet: boolean`). Worked example: loyalty QR claim
(`packages/loyalty-sdk` + wellversed-2.0 `src/app/api/loyalty/*` +
`apps/backend/src/modules/loyalty/qr/claim-signature.service.ts`).

Prefer this over the browser-calls-vendor-backend model for anything
identity-bearing: the trust boundary is the storefront's, KwikPass stays where
it already lives, and the vendor backend never holds a third-party dependency.

## Checklist for a new app's storefront widget

- [ ] SDK: global + `init(containerId | null, config) → cleanup`, self-init
      fallback, event bridge, size budgets, `/<slug>/sdk/*` serving (Part 1).
- [ ] Wrapper: `src/widgets/common/<Feature>/` 4-file anatomy copied from FBT.
- [ ] Cheap gate; `loadSdkOnce`; init + cleanup; skeleton if inline.
- [ ] Registry entry + template placement (page section vs root-level).
- [ ] `NEXT_PUBLIC_<FEATURE>_*` envs documented.
- [ ] Storefront origin in the backend's `ALLOWED_ORIGINS` (only if the browser
      calls the vendor backend directly — not needed with the BFF-signing pattern).
- [ ] Identity-bearing action? Use the BFF-signing pattern: same-origin BFF
      resolves the phone + HMAC-signs per-merchant; backend verifies only.
- [ ] Wrapper ships as a separate PR to the storefront repo — tracked in the
      build's STATE.json notes, outside this monorepo's CI.
