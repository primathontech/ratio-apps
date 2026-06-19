/**
 * Thin HTTP seam for Ratio's (OpenStore) OAuth token endpoint. Mirrors the
 * `GoogleOAuthHttp` style: constructed with a `fetchImpl` so tests inject a fake
 * and the provider has no direct network dependency to mock.
 *
 * Unlike Google, Ratio ROTATES the refresh token on every refresh — the response
 * carries BOTH a new access token and a new refresh token, and the old refresh
 * token is invalidated. Callers must persist both.
 */
export interface RatioOAuthCreds {
  clientId: string;
  clientSecret: string;
}

export interface RatioTokenResponse {
  accessToken: string;
  /** The ROTATED refresh token — the old one is now invalid. */
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export class RatioOAuthHttp {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  /**
   * Exchange a (single-use) refresh token for a fresh access + refresh token
   * pair. POSTs the camelCase-client-field JSON body the platform expects.
   */
  async refresh(refreshToken: string, creds: RatioOAuthCreds): Promise<RatioTokenResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/v1/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
      }),
    });

    let json: {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      throw new Error(`Ratio token endpoint returned a non-JSON response (status ${res.status})`);
    }

    if (!res.ok || !json.access_token || !json.refresh_token) {
      throw new Error(
        `Ratio token endpoint error: ${json.error ?? res.status} ${json.error_description ?? ''}`.trim(),
      );
    }

    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in ?? 3600,
    };
  }
}
