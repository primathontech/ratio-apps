import type { DelhiveryServiceability, ServiceabilityOptions } from './client';

/**
 * Runtime config for the storefront SDK. The backend prepends a
 * `window.__DELHIVERY__ = { merchantId, version }` prelude to the per-merchant
 * loader it serves at `/delhivery/sdk/<merchantId>.js`; the loader fills in
 * `apiBase` from its own script origin and normalizes the full shape back onto
 * the global. **Public values only** — merchant id + backend origin; the
 * merchant's Delhivery token never reaches the browser.
 */
export interface DelhiveryRuntimeConfig {
  merchantId: string;
  /** Backend origin serving `/delhivery/api/*` and `/delhivery/sdk/*`. */
  apiBase: string;
  version: string;
}

/**
 * The headless integration surface the loader installs at
 * `window.RatioDelhivery` — the PRIMARY way a checkout (e.g. Kwik Checkout)
 * consumes serviceability; the `<delhivery-serviceability>` widget is optional.
 */
export interface RatioDelhiveryApi {
  version: string;
  merchantId: string;
  /** Check pincode serviceability against the public backend endpoint. */
  checkServiceability(
    pincode: string,
    opts?: ServiceabilityOptions,
  ): Promise<DelhiveryServiceability>;
  /** Force-inject the optional `<delhivery-serviceability>` widget bundle. */
  loadWidget(): void;
}

declare global {
  interface Window {
    __DELHIVERY__?: Partial<DelhiveryRuntimeConfig>;
    RatioDelhivery?: RatioDelhiveryApi;
  }
}
