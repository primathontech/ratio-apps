// TEMPLATE: tiny IIFE bootstrap injected via a <script> tag on the storefront.
// Customize the served path base (`/__slug__/sdk/`), the injected bundle
// filenames, and the `____SLUG____` runtime-config global to match this vendor.
import type { __Slug__StorefrontConfig } from '@ratio-app/shared';

declare global {
  interface Window {
    ____SLUG____?: __Slug__StorefrontConfig;
  }
}

let injected = false;

/** Locate the loader's own <script> tag (currentScript first, then a src match). */
function findScript(): HTMLScriptElement | null {
  return (
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[src*="__slug__-loader.js"]')
  );
}

/** Derive the backend origin and `?store=` merchant id from the loader src. */
function parseSrc(src: string): { origin: string; store: string | null } {
  const url = new URL(src);
  return { origin: url.origin, store: url.searchParams.get('store') };
}

/**
 * Boot the __Slug__ storefront SDK: read config from the script origin, stash it
 * on `window.____SLUG____`, and (when search is enabled) lazily inject the widget
 * module on first input focus, with an idle/timeout fallback.
 */
export async function boot__Slug__(): Promise<void> {
  const script = findScript();
  if (!script) return;

  const { origin, store } = parseSrc(script.src);
  if (!store) return;

  const res = await fetch(`${origin}/__slug__/sdk/config/${store}`);
  if (!res.ok) return;
  const cfg = (await res.json()) as __Slug__StorefrontConfig;

  window.____SLUG____ = cfg;
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
    injectScript(`${origin}/__slug__/sdk/__slug__-widget.js?v=${cfg.version}`, 'data-__slug__-widget');
  }

  // On the results route, eagerly inject the (separate) results-page bundle.
  const onResultsPage =
    window.location.pathname === cfg.resultsPagePath ||
    window.location.pathname.startsWith(`${cfg.resultsPagePath}/`);
  if (onResultsPage) {
    injectScript(`${origin}/__slug__/sdk/__slug__-results.js?v=${cfg.version}`, 'data-__slug__-results');
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
  void boot__Slug__();
}
