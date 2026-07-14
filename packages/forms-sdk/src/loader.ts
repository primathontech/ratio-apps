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
    if (mount.hasAttribute(UPGRADED_ATTR)) continue;
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

/** Boot once the DOM is ready (the script tag is `defer`, but be safe). */
export function bootForms(): void {
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
