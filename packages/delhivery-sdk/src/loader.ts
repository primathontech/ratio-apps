// Tiny IIFE bootstrap served per-merchant by the backend at
// `/delhivery/sdk/<merchantId>.js` (a `window.__DELHIVERY__` prelude is
// prepended server-side). Also loadable as a plain
// `<script src=".../delhivery-loader.js?store=<merchantId>">`.
//
// It installs the HEADLESS client at `window.RatioDelhivery` — the primary
// integration for Kwik Checkout — and lazily injects the optional
// `<delhivery-serviceability>` widget bundle only when that element is
// actually used. No search overlay, no results bundle: this is a
// serviceability-at-checkout SDK.
import { DelhiveryClient } from './client';
import type { DelhiveryRuntimeConfig } from './config';
import { SDK_VERSION } from './version';

/** Locate the loader's own <script> tag (currentScript first, then a src match). */
function findScript(): HTMLScriptElement | null {
  return (
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[src*="/delhivery/sdk/"]')
  );
}

/** Derive the backend origin + merchant id from the loader src (`?store=` or `/<id>.js`). */
function parseSrc(src: string): { origin: string; merchantId: string | null } {
  const url = new URL(src, window.location.href);
  const fromQuery = url.searchParams.get('store');
  const fromPath = /\/delhivery\/sdk\/([A-Za-z0-9_-]+)\.js$/.exec(url.pathname)?.[1] ?? null;
  // The shared bundle filename is not a merchant id.
  const pathId =
    fromPath === 'delhivery-loader' || fromPath === 'delhivery-widget' ? null : fromPath;
  return { origin: url.origin, merchantId: fromQuery ?? pathId };
}

/**
 * Boot the Delhivery storefront SDK. Config precedence: the backend-injected
 * `window.__DELHIVERY__` prelude, then the script's own `src`. Idempotent —
 * a second boot keeps the existing `window.RatioDelhivery`.
 */
export function bootDelhivery(): void {
  if (window.RatioDelhivery) return;

  const prelude = window.__DELHIVERY__;
  const script = findScript();
  const parsed = script?.src ? parseSrc(script.src) : null;

  const merchantId = prelude?.merchantId ?? parsed?.merchantId ?? null;
  const apiBase = (prelude?.apiBase ?? parsed?.origin ?? '').replace(/\/$/, '');
  if (!merchantId || !apiBase) return;

  const version = prelude?.version ?? SDK_VERSION;
  const cfg: DelhiveryRuntimeConfig = { merchantId, apiBase, version };
  window.__DELHIVERY__ = cfg;

  const client = new DelhiveryClient({ apiBase, merchantId });

  /** Idempotently inject the optional widget ESM bundle. */
  function loadWidget(): void {
    if (document.querySelector('script[data-delhivery-widget]')) return;
    const tag = document.createElement('script');
    tag.type = 'module';
    tag.setAttribute('data-delhivery-widget', '');
    tag.src = `${apiBase}/delhivery/sdk/delhivery-widget.js?v=${version}`;
    document.head.appendChild(tag);
  }

  window.RatioDelhivery = {
    version,
    merchantId,
    checkServiceability: (pincode, opts) => client.checkServiceability(pincode, opts),
    loadWidget,
  };

  // Lazily inject the widget bundle ONLY when the optional element is used.
  // Hosts that render the element after load call RatioDelhivery.loadWidget().
  const injectIfUsed = (): void => {
    if (document.querySelector('delhivery-serviceability')) loadWidget();
  };
  injectIfUsed();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectIfUsed, { once: true });
  }
}

// Auto-boot when pasted into a real page. `document.currentScript` is null at
// module-import time under Vitest, so this never fires during tests.
if (typeof document !== 'undefined' && document.currentScript) {
  bootDelhivery();
}
