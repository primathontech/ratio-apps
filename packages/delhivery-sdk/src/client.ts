/**
 * Typed REST wrapper over the vendor backend's **public** serviceability
 * endpoint (`GET /delhivery/api/serviceability`) using native `fetch` +
 * `AbortController` (a new check cancels the previous in-flight one — the
 * shopper is typing a PIN). Browser-safe: the request carries only PUBLIC
 * identifiers (merchantId in the query string) — the merchant's Delhivery
 * token stays on the backend, which proxies the carrier call (6h cached,
 * fail-open).
 */

/** Serviceability verdict returned by `GET /delhivery/api/serviceability`. */
export interface DelhiveryServiceability {
  serviceable: boolean;
  cod_available: boolean;
  /** Estimated-delivery band, in days from dispatch. */
  edd_min: number;
  edd_max: number;
  /** True when the band is a generic estimate, not a carrier per-lane value. */
  edd_estimated: boolean;
  carrier: string;
  /** True when the carrier API was unreachable and the backend failed OPEN. */
  degraded?: boolean;
}

/** Optional checkout context forwarded to the backend (forward-compat; v1 ignores them server-side). */
export interface ServiceabilityOptions {
  orderValue?: number;
  cod?: boolean;
}

/** Public config the {@link DelhiveryClient} is constructed with — no secrets. */
export interface DelhiveryClientConfig {
  /** Backend origin serving `/delhivery/api/*` (the loader script's origin). */
  apiBase: string;
  merchantId: string;
}

/** Thrown on an invalid pincode (status 400, pre-network) or a non-2xx response. */
export class DelhiveryClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DelhiveryClientError';
  }
}

/** 6-digit Indian PIN (no leading zero) — mirrors the backend's query schema. */
export const PINCODE_RE = /^[1-9][0-9]{5}$/;

export class DelhiveryClient {
  #abort?: AbortController;

  constructor(
    private readonly cfg: DelhiveryClientConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  /**
   * Check pincode serviceability. Validates the PIN client-side (a malformed
   * PIN rejects with status 400 before any network call), aborts the previous
   * in-flight check, and unwraps the backend's `{ data }` response envelope
   * when present.
   */
  async checkServiceability(
    pincode: string,
    opts: ServiceabilityOptions = {},
  ): Promise<DelhiveryServiceability> {
    const pin = String(pincode ?? '').trim();
    if (!PINCODE_RE.test(pin)) {
      throw new DelhiveryClientError(400, 'pincode must be a 6-digit Indian PIN');
    }

    this.#abort?.abort();
    const controller = new AbortController();
    this.#abort = controller;

    const usp = new URLSearchParams({ merchantId: this.cfg.merchantId, pincode: pin });
    if (opts.orderValue !== undefined) usp.set('order_value', String(opts.orderValue));
    if (opts.cod !== undefined) usp.set('cod', opts.cod ? 'true' : 'false');

    const base = this.cfg.apiBase.replace(/\/$/, '');
    const res = await this.fetchImpl(`${base}/delhivery/api/serviceability?${usp.toString()}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new DelhiveryClientError(res.status, await res.text());

    const body = (await res.json()) as unknown;
    // The backend's global ResponseInterceptor wraps JSON routes in a
    // `{ status_code, message, data }` envelope — unwrap it, but tolerate a
    // bare body too so the client keeps working if the route ever bypasses it.
    const payload =
      body && typeof body === 'object' && 'data' in body ? (body as { data: unknown }).data : body;
    return payload as DelhiveryServiceability;
  }
}
