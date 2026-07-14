// TEMPLATE: tiny IIFE bootstrap injected via a <script> tag on the storefront.
// Customize the served path base (`/forms/sdk/`), the injected bundle
// filenames, and the `__FORMS__` runtime-config global to match this vendor.
import type { FormsStorefrontConfig } from '@ratio-app/shared';

declare global {
  interface Window {
    __FORMS__?: FormsStorefrontConfig;
  }
}

let injected = false;

/** Locate the loader's own <script> tag (currentScript first, then a src match). */
function findScript(): HTMLScriptElement | null {
  return (
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[src*="forms-loader.js"]')
  );
}

/** Derive the backend origin and `?store=` merchant id from the loader src. */
function parseSrc(src: string): { origin: string; store: string | null } {
  const url = new URL(src);
  return { origin: url.origin, store: url.searchParams.get('store') };
}

/**
 * Boot the Forms storefront SDK: read config from the script origin, stash it
 * on `window.__FORMS__`, and (when search is enabled) lazily inject the widget
 * module on first input focus, with an idle/timeout fallback.
 */
export async function bootForms(): Promise<void> {
  const script = findScript();
  if (!script) return;

  const { origin, store } = parseSrc(script.src);
  if (!store) return;

  const res = await fetch(`${origin}/forms/sdk/config/${store}`);
  if (!res.ok) return;
  const cfg = (await res.json()) as FormsStorefrontConfig;

  window.__FORMS__ = cfg;
  if (!cfg.searchEnabled) return;

  /** Idempotently inject a `<script type="module">`, tagged with `marker`. */
  function injectScript(src: string, marker: string): void {
    if (document.querySelector(`script[${marker}]`)) return;
    const tag = document.createElement('script');
    tag.type = 'module';
    tag.setAttribute(marker, '');
    tag.src = src;
    document.head.appendChild(tag);
  }

  function injectWidget(): void {
    if (injected) return;
    injected = true;
    injectScript(`${origin}/forms/sdk/forms-widget.js?v=${cfg.version}`, 'data-forms-widget');
  }

  // On the results route, eagerly inject the (separate) results-page bundle.
  const onResultsPage =
    window.location.pathname === cfg.resultsPagePath ||
    window.location.pathname.startsWith(`${cfg.resultsPagePath}/`);
  if (onResultsPage) {
    injectScript(`${origin}/forms/sdk/forms-results.js?v=${cfg.version}`, 'data-forms-results');
  }

  const input = document.querySelector(cfg.inputSelector);
  if (input) {
    input.addEventListener('focusin', injectWidget, { once: true });
  }

  // Idle fallback so results-only / never-focused pages still load the widget.
  // Both paths are async, so tests observing "no widget yet" still hold.
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => injectWidget());
  } else {
    setTimeout(injectWidget, 4000);
  }
}

// Auto-boot when pasted into a real page. `document.currentScript` is null at
// module-import time under Vitest, so this never fires during tests.
if (typeof document !== 'undefined' && document.currentScript) {
  void bootForms();
}
