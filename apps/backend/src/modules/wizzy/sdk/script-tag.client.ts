/**
 * Thin HTTP client for the Ratio ScriptTag API.
 *
 * This API is DRAFT on the platform (scopes `write_script_tags` /
 * `read_script_tags` report `codegen_ready: false`). All calls are guarded —
 * on failure with a `pending_api`-class error, callers record
 * `script_tag_status = 'pending_api'` and continue rather than crashing.
 *
 * Endpoints (ASSUMPTION — exact paths/shapes TBD when the API lands):
 *   POST   /api/v1/script_tags         — register a new script tag
 *   PUT    /api/v1/script_tags/:id     — update an existing script tag
 *   DELETE /api/v1/script_tags/:id     — delete a script tag
 */

export type ScriptTagApiFailureKind = 'unavailable' | 'forbidden' | 'error';

export class ScriptTagApiError extends Error {
  constructor(
    message: string,
    readonly kind: ScriptTagApiFailureKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ScriptTagApiError';
  }
}

export class ScriptTagClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  /** Register a new script tag; returns the platform script-tag id. */
  async register(accessToken: string, src: string): Promise<{ scriptTagId: string }> {
    const res = await this.call(accessToken, 'POST', '/api/v1/script_tags', { src });
    const body = (await res.json()) as { id?: string; scriptTagId?: string };
    const scriptTagId = body.id ?? body.scriptTagId;
    if (!scriptTagId) {
      throw new ScriptTagApiError('ScriptTag API returned no id', 'error', res.status);
    }
    return { scriptTagId };
  }

  /** Update an existing script tag's src URL. */
  async update(accessToken: string, scriptTagId: string, src: string): Promise<void> {
    await this.call(accessToken, 'PUT', `/api/v1/script_tags/${encodeURIComponent(scriptTagId)}`, {
      src,
    });
  }

  /** Delete a script tag. */
  async delete(accessToken: string, scriptTagId: string): Promise<void> {
    await this.call(
      accessToken,
      'DELETE',
      `/api/v1/script_tags/${encodeURIComponent(scriptTagId)}`,
    );
  }

  private async call(
    accessToken: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw new ScriptTagApiError(`ScriptTag API unreachable: ${err}`, 'unavailable');
    }

    if (res.ok) return res;

    const status = res.status;
    if (status === 404 || status === 501 || status === 502 || status === 503) {
      throw new ScriptTagApiError(`ScriptTag API not available (${status})`, 'unavailable', status);
    }
    if (status === 401 || status === 403) {
      throw new ScriptTagApiError(`ScriptTag API forbidden (${status})`, 'forbidden', status);
    }
    throw new ScriptTagApiError(`ScriptTag API error (${status})`, 'error', status);
  }
}
