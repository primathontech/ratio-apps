/**
 * Mount scanner for the forms SDK.
 *
 * The backend serves `/forms/sdk/:merchantId.js` as a config prelude
 * (`window.__FORMS_SDK_CONFIG__ = { merchantId, apiBase }` — see
 * `sdk.service.ts`) followed by the widget bundle, which registers
 * `<ratio-form>` and calls {@link bootForms}. This module is also built
 * standalone as the tiny `forms-loader.js` IIFE for setups that serve the
 * widget separately.
 *
 * `bootForms` upgrades every `<div data-ratio-form="FORM_ID">` on the page
 * into a `<ratio-form form-id="FORM_ID">` renderer. Idempotent: mounts are
 * marked so a second call (or a second script include) never double-renders.
 */

export interface FormsSdkConfig {
  merchantId: string;
  /** Public API base the renderer talks to (e.g. `/forms`). */
  apiBase: string;
}

declare global {
  interface Window {
    __FORMS_SDK_CONFIG__?: FormsSdkConfig;
    /** Manual re-scan hook for host apps that prefer explicit control. */
    RatioForms?: { upgrade: () => number };
  }
}

const MOUNT_SELECTOR = '[data-ratio-form]';
const UPGRADED_ATTR = 'data-ratio-form-mounted';

/** Upgrade all un-upgraded mounts. Returns the number upgraded. */
export function upgradeMounts(root: ParentNode = document): number {
  const cfg = window.__FORMS_SDK_CONFIG__;
  if (!cfg?.apiBase) return 0;
  let upgraded = 0;
  for (const mount of Array.from(root.querySelectorAll<HTMLElement>(MOUNT_SELECTOR))) {
    // A mount is "done" when it holds its renderer — not merely when the marker
    // attr is set. If a host framework re-renders and drops the injected child,
    // this self-heals on the next scan instead of leaving a permanently-blank
    // mount stuck behind a stale attr. UPGRADED_ATTR stays as a CSS/debug hook.
    if (Array.from(mount.children).some((c) => c.tagName.toLowerCase() === 'ratio-form')) continue;
    const formId = mount.getAttribute('data-ratio-form');
    if (!formId) continue;
    mount.setAttribute(UPGRADED_ATTR, '');
    const el = document.createElement('ratio-form');
    el.setAttribute('form-id', formId);
    mount.appendChild(el);
    upgraded += 1;
  }
  return upgraded;
}

let observer: MutationObserver | undefined;
let scanScheduled = false;
let cancelScan: (() => void) | undefined;

/**
 * Coalesce re-scans to at most one per frame. The observer can fire many times
 * during a render burst (and upgrading a mount is itself a DOM mutation that
 * re-triggers it); debouncing keeps that to a single document scan instead of
 * one per batch. Falls back to a macrotask where rAF is unavailable (tests/SSR).
 */
function scheduleScan(): void {
  if (scanScheduled) return;
  scanScheduled = true;
  const flush = () => {
    cancelScan = undefined;
    scanScheduled = false;
    upgradeMounts();
  };
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(flush);
    cancelScan = () => cancelAnimationFrame(id);
  } else {
    const id = setTimeout(flush, 0);
    cancelScan = () => clearTimeout(id);
  }
}

/**
 * Watch for mounts added after the initial scan. A one-shot scan only sees the
 * mounts present when the SDK loads — but single-page apps (Next.js, React
 * Router) render the `[data-ratio-form]` div on client-side navigation, AFTER
 * the SDK has already run, and streamed/hydrated content can arrive late too.
 * A removal is watched too: it lets the self-healing child guard re-mount if a
 * framework re-render drops the injected renderer. One observer per page;
 * `upgradeMounts` is idempotent, so repeat callbacks never double-render.
 */
function observeMounts(): void {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.addedNodes.length || r.removedNodes.length) {
        scheduleScan();
        return;
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

/** Stop watching for late mounts (test cleanup; rarely needed in production). */
export function stopObserving(): void {
  observer?.disconnect();
  observer = undefined;
  cancelScan?.();
  cancelScan = undefined;
  scanScheduled = false;
}

/** Scan now (or once the DOM is ready) and keep watching for late mounts. */
export function bootForms(): void {
  window.RatioForms = { upgrade: () => upgradeMounts() };
  observeMounts();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void upgradeMounts(), { once: true });
    return;
  }
  upgradeMounts();
}

// Auto-boot when included as the standalone loader bundle on a real page.
// `document.currentScript` is null at module-import time under Vitest, so
// this never fires during tests.
if (typeof document !== 'undefined' && document.currentScript) {
  bootForms();
}
