import { compilePathPattern, scriptConfig } from './loader';
import './return-button';

/**
 * Zero-configuration button placement for storefronts on the shared GoKwik
 * storefront-builder convention (bblunt/momsco/plixkids): order id lives in the
 * URL/DOM, never in app state the SDK can't reach. So instead of requiring the
 * merchant to wire order/email props into their React tree, this scans the page:
 *  - order-detail page (path matches orderDetailPath) → floating button, order id
 *    from the URL itself.
 *  - order-list page (path matches orderListPath) → a button next to every row's
 *    "View"-style link, order id from that link's own href.
 * No merchant code beyond the single script tag. Overridable via script-tag
 * data-order-detail-path / data-order-list-path if a storefront's routes differ.
 */

const detailPattern = compilePathPattern(scriptConfig.orderDetailPath);
// The list pattern doubles as the href-prefix for list-page row links (same route,
// sans the trailing id), so both checks share one derivation.
const listBasePath = scriptConfig.orderListPath.replace(/\/$/, '');
const listPattern = new RegExp(`^${listBasePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`);

const AUTO_DETAIL_MARK = 'rp-auto-detail';

function currentDetailOrderId(): string | null {
  const m = location.pathname.match(detailPattern);
  return m?.[1] ?? null;
}

function syncDetailButton(): void {
  const orderId = currentDetailOrderId();
  const existing = document.querySelector(`rp-return-button[data-${AUTO_DETAIL_MARK}]`);
  if (!orderId) {
    existing?.remove();
    return;
  }
  if (existing?.getAttribute('order-id') === orderId) return;
  existing?.remove();
  const el = document.createElement('rp-return-button');
  el.setAttribute(`data-${AUTO_DETAIL_MARK}`, '');
  el.setAttribute('floating', '');
  el.setAttribute('order-id', orderId);
  document.body.appendChild(el);
}

function syncListButtons(): void {
  if (!listPattern.test(location.pathname)) return;
  const links = document.querySelectorAll<HTMLAnchorElement>(`a[href^="${listBasePath}/"]`);
  links.forEach((link) => {
    // Only immediate row "view" links (one path segment past the list base) — not
    // any other in-page link that happens to share the prefix. Resolve through URL
    // first: matching the raw href fails silently when it carries a query string
    // (tracking/pagination params) since detailPattern is end-anchored.
    const href = link.getAttribute('href');
    const orderId = href
      ? new URL(href, location.origin).pathname.match(detailPattern)?.[1]
      : undefined;
    if (!orderId) return;
    if (link.nextElementSibling?.tagName === 'RP-RETURN-BUTTON') return;
    const el = document.createElement('rp-return-button');
    el.setAttribute('order-id', orderId);
    link.insertAdjacentElement('afterend', el);
  });
}

function sync(): void {
  syncDetailButton();
  syncListButtons();
}

function debounce(fn: () => void, ms: number): () => void {
  let handle: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (handle) clearTimeout(handle);
    handle = setTimeout(fn, ms);
  };
}

const debouncedSync = debounce(sync, 120);

/** Caller (index.ts) already waits for DOMContentLoaded before invoking this. */
export function startAutoInject(): void {
  sync();

  // Next.js/SPA client-side navigation doesn't reload the page — re-check on both
  // history mutation (list → detail) and DOM mutation (client-side pagination,
  // which can re-render the list without a URL change).
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History[typeof method]>) {
      const result = original.apply(this, args);
      debouncedSync();
      return result;
    };
  }
  window.addEventListener('popstate', debouncedSync);

  new MutationObserver(debouncedSync).observe(document.body, { childList: true, subtree: true });
}
