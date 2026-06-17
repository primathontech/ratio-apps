/**
 * Thin, typed HTTP client for the Google Content API for Shopping (v2.1).
 *
 * Intentionally avoids the heavy `googleapis` SDK and uses the global `fetch`
 * (Node 22) so it is trivially mockable in unit tests via the `fetchImpl`
 * injection point. Never logs access tokens.
 */

/** A Google Merchant Center product payload. Kept loose — the mapper produces it. */
export type GmcProduct = Record<string, unknown>;

/** A product resource returned by the Content API. */
export interface GmcProductResponse {
  id?: string;
  [k: string]: unknown;
}

/** A single entry in a custombatch request. */
export interface BatchEntry {
  batchId: number;
  merchantId: string;
  method: 'insert' | 'update' | 'delete';
  product?: GmcProduct;
  productId?: string;
}

/** The response body of a custombatch request. */
export interface GmcBatchResponse {
  entries?: Array<{
    batchId: number;
    errors?: { errors: { message: string }[] };
  }>;
}

/** Constructor options for {@link ContentApiClient}. */
export interface ContentApiClientOptions {
  merchantId: string;
  getAccessToken: () => Promise<string>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://shoppingcontent.googleapis.com/content/v2.1';

/**
 * Error thrown for any non-2xx Content API response.
 *
 * Carries the HTTP `status` and the parsed Google error message. On HTTP 429
 * `isRateLimited` is `true` so callers can back off.
 */
export class ContentApiError extends Error {
  readonly status: number;
  readonly isRateLimited: boolean;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ContentApiError';
    this.status = status;
    this.isRateLimited = status === 429;
  }
}

/** Shape of a Google API error body. */
interface GoogleErrorBody {
  error?: { message?: string };
}

/**
 * A minimal, typed client for the Google Content API for Shopping v2.1.
 *
 * Every request carries `Authorization: Bearer <token>` (token sourced from
 * the injected `getAccessToken`) and `Content-Type: application/json`.
 */
export class ContentApiClient {
  private readonly merchantId: string;
  private readonly getAccessToken: () => Promise<string>;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ContentApiClientOptions) {
    this.merchantId = options.merchantId;
    this.getAccessToken = options.getAccessToken;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /**
   * Insert a new product.
   * POST `${baseUrl}/${merchantId}/products`
   */
  async insertProduct(product: GmcProduct): Promise<GmcProductResponse> {
    return this.request<GmcProductResponse>(
      'POST',
      `${this.baseUrl}/${this.merchantId}/products`,
      product,
    );
  }

  /**
   * Update (replace) an existing product.
   * PUT `${baseUrl}/${merchantId}/products/${productId}`
   */
  async updateProduct(
    productId: string,
    product: GmcProduct,
  ): Promise<GmcProductResponse> {
    return this.request<GmcProductResponse>(
      'PUT',
      `${this.baseUrl}/${this.merchantId}/products/${encodeURIComponent(productId)}`,
      product,
    );
  }

  /**
   * Delete a product. Resolves on 200/204.
   * DELETE `${baseUrl}/${merchantId}/products/${productId}`
   */
  async deleteProduct(productId: string): Promise<void> {
    await this.request<void>(
      'DELETE',
      `${this.baseUrl}/${this.merchantId}/products/${encodeURIComponent(productId)}`,
    );
  }

  /**
   * List products (250 per page). Pass `nextPageToken` to paginate.
   * GET `${baseUrl}/${merchantId}/products?maxResults=250`
   */
  async listProducts(
    pageToken?: string,
  ): Promise<{ resources: GmcProductResponse[]; nextPageToken?: string }> {
    let url = `${this.baseUrl}/${this.merchantId}/products?maxResults=250`;
    if (pageToken) {
      url += `&pageToken=${encodeURIComponent(pageToken)}`;
    }
    const body = await this.request<{
      resources?: GmcProductResponse[];
      nextPageToken?: string;
    }>('GET', url);
    return {
      resources: body.resources ?? [],
      // Only include the key when present (exactOptionalPropertyTypes).
      ...(body.nextPageToken ? { nextPageToken: body.nextPageToken } : {}),
    };
  }

  /**
   * List the Merchant Center accounts the authenticated user can access.
   * GET `${baseUrl}/accounts/authinfo`
   */
  async getAuthinfo(): Promise<Array<{ merchantId: string }>> {
    const body = await this.request<{
      accountIdentifiers?: Array<{ merchantId?: string; aggregatorId?: string }>;
    }>('GET', `${this.baseUrl}/accounts/authinfo`);
    return (body.accountIdentifiers ?? [])
      .filter((a): a is { merchantId: string } => typeof a.merchantId === 'string')
      .map((a) => ({ merchantId: a.merchantId }));
  }

  /**
   * Submit a batch of product operations.
   * POST `${baseUrl}/products/batch` with `{ entries }`.
   *
   * Callers performing an initial sync should batch entries in chunks of 1000
   * via {@link ContentApiClient.chunk} to stay within Google's limits.
   */
  async custombatch(entries: BatchEntry[]): Promise<GmcBatchResponse> {
    return this.request<GmcBatchResponse>(
      'POST',
      `${this.baseUrl}/products/batch`,
      { entries },
    );
  }

  /**
   * Split `items` into sub-arrays of at most `size` elements.
   *
   * Recommended for initial sync: batch in chunks of 1000.
   */
  static chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Perform an authenticated request and parse/validate the response.
   *
   * @throws {ContentApiError} for any non-2xx response.
   */
  private async request<T>(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await this.fetchImpl(url, init);

    if (!response.ok) {
      let message = response.statusText;
      try {
        const errorBody = (await response.json()) as GoogleErrorBody;
        if (errorBody?.error?.message) {
          message = errorBody.error.message;
        }
      } catch {
        // Non-JSON error body — fall back to statusText.
      }
      throw new ContentApiError(response.status, message);
    }

    // 204 No Content (and empty 200s) carry no parseable body.
    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }
}
