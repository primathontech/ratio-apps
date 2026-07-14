// TEMPLATE: storefront search-widget bootstrap. Customize the API base URL below
// and the `__FORMS__` runtime-config global/shape to match this vendor.
import type { FormsStorefrontConfig } from '@ratio-app/shared';
import { getAnonId } from './anon-id';
import { FormsClient } from './client';
import { RecentStore } from './recent-store';
import './ui/search-overlay';
import type { FormsSearchOverlay } from './ui/search-overlay';

// TEMPLATE: replace with the vendor's search API base URL.
const FORMS_API_BASE = 'https://api.forms.example/v1';

/**
 * Bootstrap the Forms search widget on the storefront.
 *
 * Reads `window.__FORMS__` (the storefront runtime config injected by the
 * loader), wires the search input to a `<forms-search-overlay>`, and navigates
 * to the results page on submit. No-ops when config is missing/disabled or the
 * input selector matches nothing.
 */
export function boot(): void {
  const cfg = (window as Window & { __FORMS__?: FormsStorefrontConfig }).__FORMS__;
  if (!cfg?.searchEnabled) return;

  const client = new FormsClient({
    baseUrl: FORMS_API_BASE,
    storeId: cfg.storeId,
    apiKey: cfg.apiKey,
    userId: getAnonId(),
  });
  const recent = new RecentStore(cfg.storeId);

  const input = document.querySelector<HTMLInputElement>(cfg.inputSelector);
  if (!input) return;

  const overlay = document.createElement('forms-search-overlay') as FormsSearchOverlay;
  overlay.client = client;
  overlay.recent = recent;
  overlay.themePrimary = cfg.theme?.primary ?? '#0fb3a9';
  document.body.appendChild(overlay);

  // Position the overlay directly beneath the input.
  const place = (): void => {
    const r = input.getBoundingClientRect();
    overlay.style.position = 'absolute';
    overlay.style.top = `${r.bottom + window.scrollY}px`;
    overlay.style.left = `${r.left + window.scrollX}px`;
    overlay.style.width = `${r.width}px`;
    overlay.style.zIndex = '2147483000';
  };
  place();

  input.addEventListener('focusin', () => {
    place();
    overlay.open = true;
    void overlay.loadEmptyState();
  });
  input.addEventListener('input', () => {
    place();
    overlay.onInput(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      overlay.submit(input.value);
    }
  });

  // Close when clicking outside the overlay and input.
  document.addEventListener('click', (e) => {
    if (!overlay.contains(e.target as Node) && e.target !== input) overlay.open = false;
  });

  overlay.addEventListener('forms-submit', (e) => {
    const q = (e as CustomEvent<{ q: string }>).detail.q;
    recent.add(q);
    const url = `${cfg.resultsPagePath}?q=${encodeURIComponent(q)}`;
    window.location.assign(url);
  });

  // The results page ships as a separate `forms-results.js` bundle, injected by
  // the loader on the results route — it is intentionally NOT part of this
  // overlay widget bundle (keeps `forms-widget.js` small).
}

if (typeof window !== 'undefined') boot();
