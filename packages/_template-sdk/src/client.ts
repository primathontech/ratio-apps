// TEMPLATE: this file is the VENDOR-SPECIFIC API contract — the part each new
// storefront SDK MUST rewrite. Replace the auth headers, endpoint paths, request
// params, and response types below with THIS vendor's public search API. The
// result types (`__Slug__*Result`) come from `@ratio-app/shared` — define them
// there per vendor. Document the contract in `docs/README.md`.
import type {
  __Slug__AutocompleteResult,
  __Slug__SearchResult,
  __Slug__TrendingResult,
} from '@ratio-app/shared';

/**
 * Public storefront config the {@link __Slug__Client} is constructed with.
 *
 * Only the **public** __Slug__ credentials live here — `storeId` + `apiKey`. A
 * private `storeSecret` must NEVER reach the browser, so this interface has no
 * field for one.
 */
export interface __Slug__ClientConfig {
  baseUrl: string;
  storeId: string;
  apiKey: string;
  userId?: string;
}

/** Thrown when a __Slug__ endpoint responds with a non-2xx status. */
export class __Slug__ClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = '__Slug__ClientError';
  }
}

/**
 * The __Slug__ CommonFilter model (`/products/filter`). Permissive on purpose —
 * __Slug__/the backend own validation; the client just serializes it to JSON.
 */
export type CommonFilter = Record<string, unknown>;

type FormParams = Record<string, string | number | boolean | undefined>;

/**
 * Typed REST wrapper over the __Slug__ **public** storefront search API using
 * native `fetch` + `AbortController`. Browser-safe: sends only public auth
 * headers, never a secret.
 */
export class __Slug__Client {
  #autocompleteAbort?: AbortController;

  constructor(
    private readonly cfg: __Slug__ClientConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  private headers(): Record<string, string> {
    // TEMPLATE: replace with the auth headers THIS vendor's search API expects
    // (header names, public key/store id, anon user id header).
    return {
      'x-store-id': this.cfg.storeId,
      'x-api-key': this.cfg.apiKey,
      ...(this.cfg.userId ? { 'x-__slug__-userId': this.cfg.userId } : {}),
    };
  }

  private async postForm<T>(path: string, params: FormParams, signal?: AbortSignal): Promise<T> {
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) usp.append(key, String(value));
    }
    const res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...this.headers(),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: usp.toString(),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw new __Slug__ClientError(res.status, await res.text());
    return (await res.json()) as T;
  }

  /** Autocomplete overlay. Aborts any in-flight autocomplete first. */
  async autocomplete(
    q: string,
    opts: { suggestionsCount?: number; productsCount?: number; currency?: string } = {},
  ): Promise<__Slug__AutocompleteResult> {
    this.#autocompleteAbort?.abort();
    const controller = new AbortController();
    this.#autocompleteAbort = controller;
    // TEMPLATE: replace the endpoint path + params with this vendor's autocomplete endpoint.
    return this.postForm<__Slug__AutocompleteResult>(
      '/autocomplete',
      {
        q,
        suggestionsCount: opts.suggestionsCount,
        productsCount: opts.productsCount ?? 6,
        currency: opts.currency,
      },
      controller.signal,
    );
  }

  /** Full search results page. */
  async search(
    q: string,
    opts: { productsCount?: number; currency?: string } = {},
  ): Promise<__Slug__SearchResult> {
    // TEMPLATE: replace the endpoint path + params with this vendor's search endpoint.
    return this.postForm<__Slug__SearchResult>('/products/search', {
      q,
      productsCount: opts.productsCount,
      currency: opts.currency,
    });
  }

  /** Faceted/filtered listing — serializes the CommonFilter model as JSON. */
  async filter(
    filters: CommonFilter,
    opts: { q?: string; productsCount?: number } = {},
  ): Promise<__Slug__SearchResult> {
    // TEMPLATE: replace the endpoint path + params with this vendor's faceted/filter endpoint.
    return this.postForm<__Slug__SearchResult>('/products/filter', {
      filters: JSON.stringify(filters),
      q: opts.q,
      productsCount: opts.productsCount,
    });
  }

  /** Trending searches. */
  async trending(size = 6): Promise<__Slug__TrendingResult> {
    // TEMPLATE: replace the endpoint path + params with this vendor's trending-searches endpoint.
    const res = await this.fetchImpl(`${this.cfg.baseUrl}/trendingSearches?size=${size}`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (!res.ok) throw new __Slug__ClientError(res.status, await res.text());
    return (await res.json()) as __Slug__TrendingResult;
  }

  /** Fire-and-forget analytics event — never throws, never rejects. */
  async event(kind: 'click' | 'view' | 'converted', body: Record<string, unknown>): Promise<void> {
    try {
      // TEMPLATE: replace the endpoint path + body with this vendor's analytics-event endpoint.
      await this.fetchImpl(`${this.cfg.baseUrl}/events/${kind}`, {
        method: 'POST',
        headers: {
          ...this.headers(),
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      // fire-and-forget: swallow all errors and non-ok statuses
    }
  }
}
