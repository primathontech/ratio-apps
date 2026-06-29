import type {
  WizzyAutocompleteResult,
  WizzySearchResult,
  WizzyTrendingResult,
} from '@ratio-app/shared';

/**
 * Public storefront config the {@link WizzyClient} is constructed with.
 *
 * Only the **public** Wizzy credentials live here — `storeId` + `apiKey`. A
 * private `storeSecret` must NEVER reach the browser, so this interface has no
 * field for one.
 */
export interface WizzyClientConfig {
  baseUrl: string;
  storeId: string;
  apiKey: string;
  userId?: string;
}

/** Thrown when a Wizzy endpoint responds with a non-2xx status. */
export class WizzyClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'WizzyClientError';
  }
}

/**
 * The Wizzy CommonFilter model (`/products/filter`). Permissive on purpose —
 * Wizzy/the backend own validation; the client just serializes it to JSON.
 */
export type CommonFilter = Record<string, unknown>;

type FormParams = Record<string, string | number | boolean | undefined>;

/**
 * Typed REST wrapper over the Wizzy **public** storefront search API using
 * native `fetch` + `AbortController`. Browser-safe: sends only public auth
 * headers, never a secret.
 */
export class WizzyClient {
  #autocompleteAbort?: AbortController;

  constructor(
    private readonly cfg: WizzyClientConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  private headers(): Record<string, string> {
    return {
      'x-store-id': this.cfg.storeId,
      'x-api-key': this.cfg.apiKey,
      ...(this.cfg.userId ? { 'x-wizzy-userId': this.cfg.userId } : {}),
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
    if (!res.ok) throw new WizzyClientError(res.status, await res.text());
    return (await res.json()) as T;
  }

  /** Autocomplete overlay. Aborts any in-flight autocomplete first. */
  async autocomplete(
    q: string,
    opts: { suggestionsCount?: number; productsCount?: number; currency?: string } = {},
  ): Promise<WizzyAutocompleteResult> {
    this.#autocompleteAbort?.abort();
    const controller = new AbortController();
    this.#autocompleteAbort = controller;
    return this.postForm<WizzyAutocompleteResult>(
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
  ): Promise<WizzySearchResult> {
    return this.postForm<WizzySearchResult>('/products/search', {
      q,
      productsCount: opts.productsCount,
      currency: opts.currency,
    });
  }

  /** Faceted/filtered listing — serializes the CommonFilter model as JSON. */
  async filter(
    filters: CommonFilter,
    opts: { q?: string; productsCount?: number } = {},
  ): Promise<WizzySearchResult> {
    return this.postForm<WizzySearchResult>('/products/filter', {
      filters: JSON.stringify(filters),
      q: opts.q,
      productsCount: opts.productsCount,
    });
  }

  /** Trending searches. */
  async trending(size = 6): Promise<WizzyTrendingResult> {
    const res = await this.fetchImpl(`${this.cfg.baseUrl}/trendingSearches?size=${size}`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (!res.ok) throw new WizzyClientError(res.status, await res.text());
    return (await res.json()) as WizzyTrendingResult;
  }

  /** Fire-and-forget analytics event — never throws, never rejects. */
  async event(kind: 'click' | 'view' | 'converted', body: Record<string, unknown>): Promise<void> {
    try {
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
