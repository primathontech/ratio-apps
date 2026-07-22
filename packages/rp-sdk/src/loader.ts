/**
 * Script-tag config for the drop-in SDK. Merchants load one tag:
 *   <script type="module" src="https://<adapter>/rp/sdk/rp-portal.js?store=<rp-store>[&floating=1]"></script>
 *
 * - adapterUrl derives from where the script itself was fetched (import.meta.url
 *   origin) — never configured by the merchant.
 * - store / floating come from the script URL's query params (primary, since they
 *   survive any loader), with `data-store` / `data-floating` attributes on the
 *   matching <script> tag as a fallback.
 *
 * This module MUST be imported before return-button.ts declares its class:
 * customElements.define() upgrades pre-existing elements synchronously, so the
 * defaults have to exist before that runs.
 */
export interface RpScriptConfig {
  store: string;
  adapterUrl: string;
  floating: boolean;
  /** Order-detail page path template, e.g. "/pages/orders/:id". Matches the shared
   *  GoKwik storefront-builder convention (bblunt/momsco/plixkids) by default. */
  orderDetailPath: string;
  /** Order-list page path, e.g. "/pages/orders". */
  orderListPath: string;
  /** Opt-in: navigate here instead of opening the iframe modal (e.g. "/apps/return_prime"),
   *  for storefronts that already have their own chrome-wrapped returns page. Empty by
   *  default — most storefronts don't have one, so the modal (which works everywhere,
   *  no page required) stays the safe default. */
  redirectTo: string;
  /** Path of the merchant's own chrome-wrapped returns page (matches redirectTo, when set).
   *  When the current page matches, the SDK finds `[data-rp-mount]` on the page and fills it
   *  with the enable-check + iframe itself — the page just needs to render that placeholder,
   *  no RP config/logic of its own. */
  returnPrimePath: string;
}

const DEFAULT_ORDER_DETAIL_PATH = '/pages/orders/:id';
const DEFAULT_ORDER_LIST_PATH = '/pages/orders';
const DEFAULT_RETURN_PRIME_PATH = '/apps/return_prime';

function parse(): RpScriptConfig {
  const config: RpScriptConfig = {
    store: '',
    adapterUrl: '',
    floating: false,
    orderDetailPath: DEFAULT_ORDER_DETAIL_PATH,
    orderListPath: DEFAULT_ORDER_LIST_PATH,
    redirectTo: '',
    returnPrimePath: DEFAULT_RETURN_PRIME_PATH,
  };
  try {
    const self = new URL(import.meta.url);
    config.adapterUrl = self.origin;
    config.store = self.searchParams.get('store') ?? '';
    const f = self.searchParams.get('floating');
    config.floating = f === '1' || f === 'true';
    config.orderDetailPath = self.searchParams.get('orderDetailPath') ?? config.orderDetailPath;
    config.orderListPath = self.searchParams.get('orderListPath') ?? config.orderListPath;
    config.redirectTo = self.searchParams.get('redirectTo') ?? config.redirectTo;
    config.returnPrimePath = self.searchParams.get('returnPrimePath') ?? config.returnPrimePath;

    if (typeof document !== 'undefined') {
      const tag = Array.from(document.querySelectorAll('script')).find(
        (s) => s.src === import.meta.url,
      );
      if (tag) {
        if (tag.dataset.store) config.store = tag.dataset.store;
        if (tag.dataset.adapterUrl) config.adapterUrl = tag.dataset.adapterUrl;
        if (tag.dataset.floating != null) config.floating = tag.dataset.floating !== 'false';
        if (tag.dataset.orderDetailPath) config.orderDetailPath = tag.dataset.orderDetailPath;
        if (tag.dataset.orderListPath) config.orderListPath = tag.dataset.orderListPath;
        if (tag.dataset.redirectTo) config.redirectTo = tag.dataset.redirectTo;
        if (tag.dataset.returnPrimePath) config.returnPrimePath = tag.dataset.returnPrimePath;
      }
    }
  } catch {
    /* non-browser / opaque import.meta.url — leave defaults empty */
  }
  return config;
}

export const scriptConfig: RpScriptConfig = parse();

/** Compiles a ":id"-style path template into an anchored capture regex. */
export function compilePathPattern(template: string): RegExp {
  const escaped = template
    .split('/')
    .map((seg) => (seg === ':id' ? '([^/?]+)' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${escaped}/?$`);
}
