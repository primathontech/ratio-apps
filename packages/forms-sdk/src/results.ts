// TEMPLATE: storefront results-page bootstrap (ships as its own bundle).
// Customize the API base URL below and the `__FORMS__` runtime-config
// global/shape to match this vendor.
import type { FormsStorefrontConfig } from '@ratio-app/shared';
import { getAnonId } from './anon-id';
import { FormsClient } from './client';
import './ui/results-page';
import type { FormsResultsPage } from './ui/results-page';

// TEMPLATE: replace with the vendor's search API base URL.
const FORMS_API_BASE = 'https://api.forms.example/v1';

/**
 * Bootstrap the Forms results page.
 *
 * Reads `window.__FORMS__` (the storefront runtime config injected by the
 * loader), reads the `q` query param, and mounts a `<forms-results-page>` into
 * `resultsMountSelector`. No-ops when config or the mount node is missing.
 *
 * Ships as its own ESM bundle (`forms-results.js`), injected by the loader only
 * on the results route — keeping it out of the overlay widget bundle.
 */
export function bootResults(): void {
  const cfg = (window as Window & { __FORMS__?: FormsStorefrontConfig }).__FORMS__;
  if (!cfg) return;

  const mount = document.querySelector(cfg.resultsMountSelector);
  if (!mount) return;

  const q = new URLSearchParams(window.location.search).get('q') ?? '';

  const client = new FormsClient({
    baseUrl: FORMS_API_BASE,
    storeId: cfg.storeId,
    apiKey: cfg.apiKey,
    userId: getAnonId(),
  });

  const page = document.createElement('forms-results-page') as FormsResultsPage;
  page.client = client;
  page.query = q;
  page.themePrimary = cfg.theme?.primary ?? '#0fb3a9';
  mount.innerHTML = '';
  mount.appendChild(page);
}

if (typeof window !== 'undefined') bootResults();
