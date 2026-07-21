// Tiny dependency-free IIFE loader (NO Lit here — size budget 4 KB) served at
// `{apiBase}/loyalty/sdk/loyalty-loader.js?store={merchantId}`.
//
// Exposes `window.RatioLoyalty.initClaim(containerId | null, config)` for the
// Shopkit wrapper widget, and SELF-INITS in overlay mode when the page URL has
// `?loyalty_qr=` and no wrapper claimed init within a tick — so a plain
// `<script src>` include works on any non-Shopkit storefront. Zero cost when
// the param is absent: no claim bundle fetch, no API call.

/** Overrides the Shopkit wrapper may pass to `initClaim`. */
export interface InitClaimConfig {
  merchantId?: string;
  apiBaseUrl?: string;
}

/** The public window global. */
export interface RatioLoyaltyGlobal {
  initClaim: (containerId: string | null, config?: InitClaimConfig) => () => void;
}

declare global {
  interface Window {
    RatioLoyalty?: RatioLoyaltyGlobal;
  }
}

const QR_PARAM = 'loyalty_qr';
const WIDGET_TAG = 'loyalty-claim-widget';
const CLAIM_BUNDLE_MARKER = 'data-loyalty-claim';

/** Set once ANY init happens — suppresses the deferred self-init. */
let initCalled = false;
/** The loader's own <script>, captured at boot while `currentScript` is live. */
let scriptRef: HTMLScriptElement | null = null;

const noop = (): void => {};

function findScript(): HTMLScriptElement | null {
  return (
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[src*="loyalty-loader.js"]')
  );
}

/**
 * Derive the backend base + merchant id from the loader's own src, which is
 * `{apiBase}/loyalty/sdk/loyalty-loader.js?store={merchantId}` (apiBase may
 * carry a path prefix).
 */
export function parseScriptSrc(src: string): { apiBase: string; merchantId: string | null } {
  const url = new URL(src, typeof location === 'undefined' ? undefined : location.href);
  const prefix = url.pathname.replace(/\/loyalty\/sdk\/loyalty-loader\.js$/, '');
  return {
    apiBase: `${url.origin}${prefix === '/' ? '' : prefix}`,
    merchantId: url.searchParams.get('store'),
  };
}

/** Read the QR code from the current page URL. */
function qrCode(): string | null {
  return new URLSearchParams(window.location.search).get(QR_PARAM);
}

/** Inject the ESM claim bundle once (defines `<loyalty-claim-widget>`). */
function injectClaimBundle(apiBase: string): void {
  if (document.querySelector(`script[${CLAIM_BUNDLE_MARKER}]`)) return;
  const tag = document.createElement('script');
  tag.type = 'module';
  tag.setAttribute(CLAIM_BUNDLE_MARKER, '');
  tag.src = `${apiBase}/loyalty/sdk/loyalty-claim.js`;
  document.head.appendChild(tag);
}

/**
 * Mount the claim widget for the `?loyalty_qr=` code on the current URL.
 * `containerId` string ⇒ render inline into that element; `null` ⇒ overlay
 * appended to `<body>`. Returns a cleanup that unmounts the widget.
 * No-op (and still zero network cost) when the param is absent.
 */
export function initClaim(containerId: string | null, config: InitClaimConfig = {}): () => void {
  initCalled = true;
  const code = qrCode();
  if (!code) return noop;

  const script = scriptRef ?? findScript();
  const fromScript = script?.src ? parseScriptSrc(script.src) : { apiBase: '', merchantId: null };
  const apiBase = (config.apiBaseUrl ?? fromScript.apiBase).replace(/\/+$/, '');
  const merchantId = config.merchantId ?? fromScript.merchantId ?? '';

  injectClaimBundle(apiBase);

  const widget = document.createElement(WIDGET_TAG);
  widget.setAttribute('code', code);
  widget.setAttribute('api-base', apiBase);
  if (merchantId) widget.setAttribute('merchant-id', merchantId);

  if (containerId !== null) {
    const container = document.getElementById(containerId);
    if (!container) return noop;
    container.appendChild(widget);
  } else {
    widget.setAttribute('overlay', '');
    document.body.appendChild(widget);
  }
  return () => widget.remove();
}

/** Self-init in overlay mode unless a wrapper already claimed init. */
function selfInit(): void {
  if (initCalled || !qrCode() || document.querySelector(WIDGET_TAG)) return;
  initClaim(null);
}

/**
 * Boot: publish the global and schedule the self-init check for one tick
 * after DOM ready, giving a wrapper (which loads this script and then calls
 * `initClaim` itself) the chance to claim init first.
 */
export function bootLoyaltyLoader(): void {
  scriptRef = findScript();
  window.RatioLoyalty = { initClaim };
  const schedule = (): void => {
    setTimeout(selfInit, 0);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule, { once: true });
  } else {
    schedule();
  }
}

// Auto-boot when served as a real script tag. `document.currentScript` is null
// at module-import time under Vitest, so this never fires during tests.
if (typeof document !== 'undefined' && document.currentScript) {
  bootLoyaltyLoader();
}
