import type { WizzyStorefrontConfig } from '@ratio-app/shared';
import { getAnonId } from './anon-id';
import { WizzyClient } from './client';
import { RecentStore } from './recent-store';
import './ui/search-overlay';
import type { WizzySearchOverlay } from './ui/search-overlay';

const WIZZY_API_BASE = 'https://api.wizsearch.in/v1';

/**
 * Bootstrap the Wizzy search widget on the storefront.
 *
 * Reads `window.__WIZZY__` (the storefront runtime config injected by the
 * loader), wires the search input to a `<wizzy-search-overlay>`, and navigates
 * to the results page on submit. No-ops when config is missing/disabled or the
 * input selector matches nothing.
 */
export function boot(): void {
  const cfg = (window as Window & { __WIZZY__?: WizzyStorefrontConfig }).__WIZZY__;
  if (!cfg?.searchEnabled) return;

  const client = new WizzyClient({
    baseUrl: WIZZY_API_BASE,
    storeId: cfg.storeId,
    apiKey: cfg.apiKey,
    userId: getAnonId(),
  });
  const recent = new RecentStore(cfg.storeId);

  const input = document.querySelector<HTMLInputElement>(cfg.inputSelector);
  if (!input) return;

  const overlay = document.createElement('wizzy-search-overlay') as WizzySearchOverlay;
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

  overlay.addEventListener('wizzy-submit', (e) => {
    const q = (e as CustomEvent<{ q: string }>).detail.q;
    recent.add(q);
    const url = `${cfg.resultsPagePath}?q=${encodeURIComponent(q)}`;
    window.location.assign(url);
  });

  // The results page ships as a separate `wizzy-results.js` bundle, injected by
  // the loader on the results route — it is intentionally NOT part of this
  // overlay widget bundle (keeps `wizzy-widget.js` small).
}

if (typeof window !== 'undefined') boot();
