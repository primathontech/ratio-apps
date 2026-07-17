/**
 * Thin HTTP client for the Wizzy catalog API.
 *
 * Base URL: https://api.wizsearch.in/v1 (override with WIZZY_API_BASE_URL).
 *
 * Endpoints:
 *   POST   {baseUrl}/products/save   — body is a JSON array of Product objects
 *   DELETE {baseUrl}/products/delete — body is a JSON array of product id strings
 *
 * Auth headers (all three required on every catalog call):
 *   x-store-id:     <storeId>
 *   x-store-secret: <storeSecret>
 *   x-api-key:      <apiKey>
 */
import { Logger } from '@nestjs/common';
import type { WizzyProductPayload } from './wizzy-transform';

const DEFAULT_BASE_URL = 'https://api.wizsearch.in/v1';

/** Catalog-write 429 backoff: retry count + base delay (1s → 2s → 4s). */
const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 1000;

/** The envelope Wizzy returns on catalog calls. `responseId` is the trace id
 * shown in Wizzy's dashboard "API Logs". */
interface WizzyResponse {
  responseId?: string;
  requestId?: string;
  statusCode?: number;
  message?: string;
  status?: number;
  payload?: { total?: number } | unknown;
}

/**
 * Compact per-product error summary from a Wizzy failure payload — an array of
 * `{ product?: { id }, errors: { field: string[] } }`. Surfaces WHICH product +
 * field Wizzy rejected (e.g. `osmo-1 → mainImage: must be a URL`).
 */
function summarizeWizzyErrors(payload: unknown): string {
  if (!Array.isArray(payload)) return '';
  const lines: string[] = [];
  for (const entry of payload as Array<{
    product?: { id?: string };
    errors?: Record<string, unknown>;
  }>) {
    if (!entry?.errors || Object.keys(entry.errors).length === 0) continue;
    const id = entry.product?.id ?? '?';
    const fields = Object.entries(entry.errors)
      .map(([f, v]) => `${f}: ${Array.isArray(v) ? v.join('; ') : String(v)}`)
      .join(', ');
    lines.push(`${id} → ${fields}`);
    if (lines.length >= 8) {
      lines.push('…(more)');
      break;
    }
  }
  return lines.join(' | ');
}

/**
 * Error thrown for any non-2xx Wizzy API response.
 *
 * Carries the HTTP `status`. On HTTP 429 `isRateLimited` is `true`.
 * On 5xx or network errors `isTransient` is `true` — callers should
 * rethrow for SQS redrive rather than recording a permanent error.
 */
export class WizzyApiError extends Error {
  readonly status: number;
  readonly isRateLimited: boolean;
  readonly isTransient: boolean;

  /** Wizzy's `responseId` for this call (when the error body carried one). */
  readonly responseId?: string | undefined;

  constructor(status: number, message: string, responseId?: string) {
    super(message);
    this.name = 'WizzyApiError';
    this.status = status;
    this.isRateLimited = status === 429;
    // Transient: rate-limit, 5xx, or 0 (network error before HTTP status)
    this.isTransient = status === 429 || status >= 500 || status === 0;
    this.responseId = responseId;
  }
}

export interface WizzyApiClientOptions {
  storeId: string;
  storeSecret: string;
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class WizzyApiClient {
  private readonly logger = new Logger(WizzyApiClient.name);
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(readonly fetchImplDefault: typeof fetch = globalThis.fetch) {
    this.baseUrl = process.env.WIZZY_API_BASE_URL ?? DEFAULT_BASE_URL;
    this.fetchImpl = fetchImplDefault;
  }

  /**
   * Push (upsert) products to Wizzy.
   * POST {baseUrl}/products/save
   * Body: JSON array of Product objects.
   *
   * Auth headers: x-store-id / x-store-secret / x-api-key
   */
  async saveProducts(
    storeId: string,
    storeSecret: string,
    apiKey: string,
    products: WizzyProductPayload[],
  ): Promise<void> {
    await this.requestWithRateLimitRetry(
      storeId,
      storeSecret,
      apiKey,
      'POST',
      '/products/save',
      products,
    );
  }

  /**
   * Delete products from Wizzy by id.
   * DELETE {baseUrl}/products/delete
   * Body: JSON array of product id strings.
   */
  async deleteProducts(
    storeId: string,
    storeSecret: string,
    apiKey: string,
    ids: string[],
  ): Promise<void> {
    await this.requestWithRateLimitRetry(
      storeId,
      storeSecret,
      apiKey,
      'DELETE',
      '/products/delete',
      ids,
    );
  }

  /**
   * Wrap {@link request} with bounded exponential backoff on HTTP 429
   * (Wizzy rate-limits catalog writes during a bulk sync). Retries up to
   * {@link RATE_LIMIT_MAX_RETRIES} times (≈1s, 2s, 4s); any non-429 error, or a
   * 429 past the budget, is rethrown so the caller records it as before.
   */
  private async requestWithRateLimitRetry(
    storeId: string,
    storeSecret: string,
    apiKey: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request(storeId, storeSecret, apiKey, method, path, body);
      } catch (err) {
        if (err instanceof WizzyApiError && err.isRateLimited && attempt < RATE_LIMIT_MAX_RETRIES) {
          const delayMs = RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt;
          this.logger.warn({
            msg: 'wizzy rate-limited (429) — backing off',
            path,
            attempt: attempt + 1,
            delayMs,
          });
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Send a storefront analytics event. POST {baseUrl}/events/{kind}.
   * Wizzy's events API requires the SAME 3-header auth as catalog writes
   * (storeId + storeSecret + apiKey) — public auth is rejected with 403.
   * Fire-and-forget: failures are logged, never thrown, so analytics can never
   * break the caller.
   */
  async sendEvent(
    storeId: string,
    storeSecret: string,
    apiKey: string,
    kind: 'click' | 'view' | 'converted',
    body: Record<string, unknown>,
    userId?: string,
  ): Promise<void> {
    try {
      // x-wizzy-userId attributes the event to the visitor (personalization /
      // user-journey). Sent only when a stable id is available.
      const extraHeaders = userId ? { 'x-wizzy-userId': userId } : undefined;
      await this.request(
        storeId,
        storeSecret,
        apiKey,
        'POST',
        `/events/${kind}`,
        body,
        extraHeaders,
      );
    } catch (err) {
      this.logger.warn({ msg: 'wizzy event failed', kind, err: `${err}` });
    }
  }

  /**
   * Test-connection: call save with an empty array to validate auth without
   * mutating data. Returns { ok: true } on 2xx, { ok: false, error } otherwise.
   */
  async testConnection(
    storeId: string,
    storeSecret: string,
    apiKey: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      // Empty array validates credentials without mutating catalog data.
      await this.saveProducts(storeId, storeSecret, apiKey, []);
      return { ok: true };
    } catch (err) {
      // Wizzy authenticates the request BEFORE validating the payload, so an
      // empty-array save can only be rejected for "no products to sync" — a body
      // 400 (the HTTP call itself succeeds with 200) that PROVES the credentials
      // are valid. Genuine credential failures surface as 401/403 (or status 0
      // for a network error). Treat the no-products rejection as a passing auth check.
      if (err instanceof WizzyApiError && err.status === 400 && /product/i.test(err.message)) {
        return { ok: true };
      }
      const message = err instanceof Error ? err.message : `${err}`;
      return { ok: false, error: message };
    }
  }

  private async request(
    storeId: string,
    storeSecret: string,
    apiKey: string,
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const serializedBody = body !== undefined ? JSON.stringify(body) : undefined;
    // Log the EXACT request body we send to Wizzy, so the `/products/save`
    // payload (and any other call) can be verified against Wizzy's spec.
    this.logger.log({
      msg: `wizzy ${path} request`,
      method,
      count: Array.isArray(body) ? body.length : undefined,
      bytes: serializedBody?.length ?? 0,
      body: serializedBody,
    });
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-store-id': storeId,
          'x-store-secret': storeSecret,
          'x-api-key': apiKey,
          ...extraHeaders,
        },
        ...(serializedBody !== undefined ? { body: serializedBody } : {}),
      });
    } catch (err) {
      // Network / DNS / connection refused → transient
      throw new WizzyApiError(0, `Wizzy API unreachable: ${err}`);
    }

    // Parse the body once (Wizzy returns JSON on both success and error).
    const text = await res.text();
    let parsed: WizzyResponse | string | undefined;
    try {
      parsed = text ? (JSON.parse(text) as WizzyResponse) : undefined;
    } catch {
      parsed = text;
    }
    const env = parsed && typeof parsed === 'object' ? (parsed as WizzyResponse) : undefined;
    const responseId = env?.responseId;
    const payload = env?.payload;
    const total =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { total?: number }).total
        : undefined;

    // ⚠️ Wizzy returns HTTP 200 EVEN WHEN IT REJECTS PRODUCTS — the real outcome
    // is in the BODY (`status: 0` / `statusCode >= 400`, with per-product errors
    // under `payload[]`, and no `payload.total`). So a successful save requires
    // BOTH a 2xx HTTP status AND a non-failing body. (This is why the dashboard
    // showed 400 for a batch we'd logged as 200.)
    const bodyFailed =
      env?.status === 0 || (typeof env?.statusCode === 'number' && env.statusCode >= 400);

    if (res.ok && !bodyFailed) {
      // The responseId is the trace id visible in Wizzy's dashboard "API Logs".
      this.logger.log({ msg: `wizzy ${path}`, method, status: res.status, total, responseId });
      return parsed;
    }

    const status = env?.statusCode ?? res.status;
    const message =
      env?.message ?? (env as { error?: string } | undefined)?.error ?? res.statusText;
    const errors = summarizeWizzyErrors(payload);
    this.logger.error({
      msg: `wizzy ${path} rejected`,
      method,
      httpStatus: res.status,
      bodyStatus: env?.statusCode,
      responseId,
      message,
      errors,
      // Full raw body (truncated) so the exact rejection is shareable/debuggable.
      raw: text.slice(0, 1500),
    });
    throw new WizzyApiError(
      status,
      `Wizzy rejected (${status}): ${message}${errors ? ` — ${errors}` : ''}`,
      responseId,
    );
  }
}
