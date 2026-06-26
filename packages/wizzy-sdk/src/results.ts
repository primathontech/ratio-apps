import type { WizzyStorefrontConfig } from '@ratio-app/shared';
import { getAnonId } from './anon-id';
import { WizzyClient } from './client';
import './ui/results-page';
import type { WizzyResultsPage } from './ui/results-page';

const WIZZY_API_BASE = 'https://api.wizsearch.in/v1';

/**
 * Bootstrap the Wizzy results page.
 *
 * Reads `window.__WIZZY__` (the storefront runtime config injected by the
 * loader), reads the `q` query param, and mounts a `<wizzy-results-page>` into
 * `resultsMountSelector`. No-ops when config or the mount node is missing.
 *
 * Ships as its own ESM bundle (`wizzy-results.js`), injected by the loader only
 * on the results route — keeping it out of the overlay widget bundle.
 */
export function bootResults(): void {
  const cfg = (window as Window & { __WIZZY__?: WizzyStorefrontConfig }).__WIZZY__;
  if (!cfg) return;

  const mount = document.querySelector(cfg.resultsMountSelector);
  if (!mount) return;

  const q = new URLSearchParams(window.location.search).get('q') ?? '';

  const client = new WizzyClient({
    baseUrl: WIZZY_API_BASE,
    storeId: cfg.storeId,
    apiKey: cfg.apiKey,
    userId: getAnonId(),
  });

  const page = document.createElement('wizzy-results-page') as WizzyResultsPage;
  page.client = client;
  page.query = q;
  page.themePrimary = cfg.theme?.primary ?? '#0fb3a9';
  mount.innerHTML = '';
  mount.appendChild(page);
}

if (typeof window !== 'undefined') bootResults();
