import { JWT } from 'google-auth-library';

/**
 * Thin HTTP seam for Google's OAuth + service-account token endpoints. Kept as
 * its own injectable-ish class (constructed with a `fetchImpl` so tests inject a
 * fake) so the auth service has no direct network dependency to mock.
 *
 * OAuth authorization-code exchange and refresh are plain form POSTs to
 * `oauth2.googleapis.com/token`; the service-account path uses
 * `google-auth-library`'s JWT client to mint an access token from a key.
 */
export interface GoogleOAuthCreds {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleTokenResponse {
  accessToken: string;
  refreshToken: string | null;
  /** Seconds until the access token expires. */
  expiresIn: number;
  scope: string | null;
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

export class GoogleOAuthHttp {
  constructor(private readonly fetchImpl: typeof fetch = globalThis.fetch) {}

  /** Exchange an authorization code for tokens. */
  async exchangeCode(code: string, creds: GoogleOAuthCreds): Promise<GoogleTokenResponse> {
    const body = new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: creds.redirectUri,
      grant_type: 'authorization_code',
    });
    return this.postToken(body);
  }

  /** Exchange a refresh token for a fresh access token. */
  async refresh(refreshToken: string, creds: GoogleOAuthCreds): Promise<GoogleTokenResponse> {
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'refresh_token',
    });
    // Google does not return a new refresh_token on refresh — carry the old one.
    const res = await this.postToken(body);
    return { ...res, refreshToken: res.refreshToken ?? refreshToken };
  }

  /** Fetch the connected account's email for display. */
  async userEmail(accessToken: string): Promise<string | null> {
    const res = await this.fetchImpl(USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { email?: string };
    return body.email ?? null;
  }

  /** Mint an access token from a service-account key JSON (manual GMC path). */
  async serviceAccountToken(keyJson: string, scopes: string[]): Promise<string> {
    const key = JSON.parse(keyJson) as { client_email: string; private_key: string };
    const jwt = new JWT({ email: key.client_email, key: key.private_key, scopes });
    const { access_token } = await jwt.authorize();
    if (!access_token) throw new Error('service-account authorization returned no access token');
    return access_token;
  }

  private async postToken(body: URLSearchParams): Promise<GoogleTokenResponse> {
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      throw new Error(`Google token endpoint error: ${json.error ?? res.status} ${json.error_description ?? ''}`.trim());
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? null,
      expiresIn: json.expires_in ?? 3600,
      scope: json.scope ?? null,
    };
  }
}
