/**
 * Thin client for the Ratio **Web Pixels API** (`POST /pixels`). This API is
 * Draft on the platform (its scopes report `codegen_ready: false`), so the
 * caller ({@link PixelRegistrationService}) treats an `unavailable` failure as a
 * soft `pending_api` state rather than an error — the script-tag delivery path
 * keeps working meanwhile.
 *
 * Failure classification:
 *   - 404 / 501 / 502 / 503 / network → `unavailable` (API not live yet)
 *   - 401 / 403                       → `forbidden` (scope/token problem)
 *   - anything else non-2xx           → `error`
 */
export type WebPixelsFailureKind = 'unavailable' | 'forbidden' | 'error';

export class WebPixelsApiError extends Error {
  constructor(
    message: string,
    readonly kind: WebPixelsFailureKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'WebPixelsApiError';
  }
}

export interface WebPixelRegistration {
  /** Which adapter this pixel drives. */
  type: 'ga4' | 'google-ads';
  /** Per-merchant config injected into the adapter at runtime. */
  settings: Record<string, unknown>;
}

export class WebPixelsApi {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  /** Register (or upsert) a pixel; returns the platform pixel id. */
  async register(
    accessToken: string,
    reg: WebPixelRegistration,
  ): Promise<{ pixelId: string }> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/v1/pixels`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(reg),
      });
    } catch (err) {
      // Network / DNS / connection refused → the API isn't reachable.
      throw new WebPixelsApiError(`web pixels API unreachable: ${err}`, 'unavailable');
    }

    if (res.ok) {
      const body = (await res.json()) as { id?: string; pixelId?: string };
      const pixelId = body.id ?? body.pixelId;
      if (!pixelId) throw new WebPixelsApiError('web pixels API returned no id', 'error', res.status);
      return { pixelId };
    }

    const status = res.status;
    if (status === 404 || status === 501 || status === 502 || status === 503) {
      throw new WebPixelsApiError(`web pixels API not available (${status})`, 'unavailable', status);
    }
    if (status === 401 || status === 403) {
      throw new WebPixelsApiError(`web pixels API forbidden (${status})`, 'forbidden', status);
    }
    throw new WebPixelsApiError(`web pixels API error (${status})`, 'error', status);
  }
}
