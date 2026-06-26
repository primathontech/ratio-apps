// TEMPLATE: storefront results-page bootstrap (ships as its own bundle).
// Customize the API base URL below and the `____SLUG____` runtime-config
// global/shape to match this vendor.
import type { __Slug__StorefrontConfig } from '@ratio-app/shared';
import { getAnonId } from './anon-id';
import { __Slug__Client } from './client';
import './ui/results-page';
import type { __Slug__ResultsPage } from './ui/results-page';

// TEMPLATE: replace with the vendor's search API base URL.
const __SLUG___API_BASE = 'https://api.__slug__.example/v1';

/**
 * Bootstrap the __Slug__ results page.
 *
 * Reads `window.____SLUG____` (the storefront runtime config injected by the
 * loader), reads the `q` query param, and mounts a `<__slug__-results-page>` into
 * `resultsMountSelector`. No-ops when config or the mount node is missing.
 *
 * Ships as its own ESM bundle (`__slug__-results.js`), injected by the loader only
 * on the results route — keeping it out of the overlay widget bundle.
 */
export function bootResults(): void {
  const cfg = (window as Window & { ____SLUG____?: __Slug__StorefrontConfig }).____SLUG____;
  if (!cfg) return;

  const mount = document.querySelector(cfg.resultsMountSelector);
  if (!mount) return;

  const q = new URLSearchParams(window.location.search).get('q') ?? '';

  const client = new __Slug__Client({
    baseUrl: __SLUG___API_BASE,
    storeId: cfg.storeId,
    apiKey: cfg.apiKey,
    userId: getAnonId(),
  });

  const page = document.createElement('__slug__-results-page') as __Slug__ResultsPage;
  page.client = client;
  page.query = q;
  page.themePrimary = cfg.theme?.primary ?? '#0fb3a9';
  mount.innerHTML = '';
  mount.appendChild(page);
}

if (typeof window !== 'undefined') bootResults();
