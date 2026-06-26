import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { sql } from 'kysely';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { GoogleDatabase } from '../db/types';
import { GOOGLE_CRYPTO, GOOGLE_OAUTH_CREDS, GOOGLE_OAUTH_HTTP } from '../tokens';
import { GOOGLE_DB_TOKEN } from '../kysely.module';
import type { GoogleOAuthCreds, GoogleOAuthHttp } from './google-oauth.http';

/** Google OAuth scopes requested at consent — Analytics, Ads, Merchant Center. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/analytics.edit',
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/content',
  'openid',
  'email',
] as const;

/** Content API scope used for the service-account (manual) path. */
const CONTENT_SCOPE = 'https://www.googleapis.com/auth/content';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

/**
 * Resolves a usable Google access token for a merchant — either by refreshing
 * the stored OAuth tokens (`connection_method = 'oauth'`) or by minting one from
 * the merchant's service-account key (`'manual'`). Also drives the OAuth connect
 * + callback. All tokens/keys are encrypted at rest via {@link CryptoService}.
 *
 * A failed refresh flips `google_credentials.needs_reconnect = true` so the
 * admin can prompt the merchant to reconnect, and surfaces as a 401.
 */
@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);

  constructor(
    @Inject(GOOGLE_DB_TOKEN) private readonly handle: KyselyClient<GoogleDatabase>,
    @Inject(GOOGLE_CRYPTO) private readonly crypto: CryptoService,
    @Inject(GOOGLE_OAUTH_HTTP) private readonly http: GoogleOAuthHttp,
    @Inject(GOOGLE_OAUTH_CREDS) private readonly creds: GoogleOAuthCreds,
  ) {}

  /** Build the Google consent URL. `state` carries the Ratio merchant id. */
  buildAuthUrl(merchantId: string): string {
    const params = new URLSearchParams({
      client_id: this.creds.clientId,
      redirect_uri: this.creds.redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      scope: GOOGLE_SCOPES.join(' '),
      state: merchantId,
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  /**
   * Exchange the authorization code, persist encrypted tokens, stamp the
   * connected account email + `connection_method = 'oauth'` on the config.
   */
  async handleCallback(code: string, merchantId: string): Promise<void> {
    const tokens = await this.http.exchangeCode(code, this.creds);
    const email = await this.http.userEmail(tokens.accessToken);
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    await this.handle.db
      .insertInto('google_credentials')
      .values({
        merchantId,
        accessTokenEnc: this.crypto.encrypt(tokens.accessToken),
        refreshTokenEnc: tokens.refreshToken ? this.crypto.encrypt(tokens.refreshToken) : null,
        expiresAt,
        grantedScopes: tokens.scope,
        needsReconnect: false,
      } as never)
      .onDuplicateKeyUpdate({
        accessTokenEnc: this.crypto.encrypt(tokens.accessToken),
        // Only overwrite the refresh token when Google returned one.
        ...(tokens.refreshToken
          ? { refreshTokenEnc: this.crypto.encrypt(tokens.refreshToken) }
          : {}),
        expiresAt,
        grantedScopes: tokens.scope,
        needsReconnect: false,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .execute();

    // Reset the per-account discovered IDs on every connect. They are tied to
    // the Google account that was connected when they were saved — carrying them
    // into a newly connected account points GMC sync (and the GA4/Ads pixels) at
    // resources the new account can't access, which Google rejects as "invalid
    // creds". Nulling them lets the admin's discovery re-fill them for the
    // account just connected. Account-agnostic settings (store URL, toggles,
    // target country, etc.) are left untouched.
    await this.handle.db
      .updateTable('google_configs')
      .set({
        connectionMethod: 'oauth',
        googleAccountEmail: email,
        gmcMerchantId: null,
        ga4MeasurementId: null,
        adsConversionId: null,
        adsConversionLabel: null,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .where('merchantId', '=', merchantId)
      .execute();
  }

  /**
   * Disconnect the Google account: drop the stored OAuth credentials and flip
   * the config back to manual so the merchant can enter GA4 / Ads / Merchant
   * Center IDs by hand. The integration toggles + IDs the merchant already set
   * are left untouched — only the connection itself is severed.
   */
  async disconnect(merchantId: string): Promise<void> {
    await this.handle.db
      .deleteFrom('google_credentials')
      .where('merchantId', '=', merchantId)
      .execute();

    await this.handle.db
      .updateTable('google_configs')
      .set({
        connectionMethod: 'manual',
        googleAccountEmail: null,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .where('merchantId', '=', merchantId)
      .execute();

    this.logger.log({ msg: 'google account disconnected', merchantId });
  }

  /**
   * Resolve a token for GMC Content API calls. Prefers a stored GMC
   * service-account key when present — this lets an OAuth-connected merchant
   * still reach a Merchant Center their Google login can't access (e.g. when
   * OAuth discovery found no MC account, the merchant pastes a service-account
   * key as the fallback). Otherwise falls back to the normal per-merchant token.
   */
  async getGmcAccessToken(merchantId: string): Promise<string> {
    const config = await this.handle.db
      .selectFrom('google_configs')
      .select(['gmcServiceAccountKeyEnc'])
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (config?.gmcServiceAccountKeyEnc) {
      const keyJson = this.crypto.decrypt(config.gmcServiceAccountKeyEnc);
      return this.http.serviceAccountToken(keyJson, [CONTENT_SCOPE]);
    }
    return this.getAccessToken(merchantId);
  }

  /**
   * Return a valid access token for the merchant. OAuth path refreshes when the
   * stored token has expired; manual path mints one from the service-account
   * key. Throws {@link UnauthorizedException} (and sets `needs_reconnect`) when
   * an OAuth refresh fails.
   */
  async getAccessToken(merchantId: string): Promise<string> {
    const config = await this.handle.db
      .selectFrom('google_configs')
      .select(['connectionMethod', 'gmcServiceAccountKeyEnc'])
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();

    if (config?.connectionMethod === 'manual') {
      if (!config.gmcServiceAccountKeyEnc) {
        throw new UnauthorizedException({
          message: 'no service-account key configured',
          error_code: 'GMC_KEY_MISSING',
        });
      }
      const keyJson = this.crypto.decrypt(config.gmcServiceAccountKeyEnc);
      return this.http.serviceAccountToken(keyJson, [CONTENT_SCOPE]);
    }

    // OAuth path.
    const cred = await this.handle.db
      .selectFrom('google_credentials')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (!cred) {
      throw new UnauthorizedException({
        message: 'merchant has not connected a Google account',
        error_code: 'GOOGLE_NOT_CONNECTED',
      });
    }

    const stillValid = cred.expiresAt && new Date(cred.expiresAt).getTime() - Date.now() > 60_000;
    if (stillValid) return this.crypto.decrypt(cred.accessTokenEnc);

    if (!cred.refreshTokenEnc) {
      await this.markReconnect(merchantId);
      throw new UnauthorizedException({
        message: 'no refresh token; merchant must reconnect',
        error_code: 'GOOGLE_RECONNECT_REQUIRED',
      });
    }

    try {
      const refreshed = await this.http.refresh(
        this.crypto.decrypt(cred.refreshTokenEnc),
        this.creds,
      );
      const expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
      await this.handle.db
        .updateTable('google_credentials')
        .set({
          accessTokenEnc: this.crypto.encrypt(refreshed.accessToken),
          expiresAt,
          needsReconnect: false,
          updatedAt: sql`CURRENT_TIMESTAMP(3)`,
        } as never)
        .where('merchantId', '=', merchantId)
        .execute();
      return refreshed.accessToken;
    } catch (err) {
      this.logger.warn({ msg: 'google token refresh failed', merchantId });
      await this.markReconnect(merchantId);
      throw new UnauthorizedException({
        message: 'google token refresh failed; merchant must reconnect',
        error_code: 'GOOGLE_RECONNECT_REQUIRED',
        cause: err,
      });
    }
  }

  private async markReconnect(merchantId: string): Promise<void> {
    await this.handle.db
      .updateTable('google_credentials')
      .set({ needsReconnect: true, updatedAt: sql`CURRENT_TIMESTAMP(3)` } as never)
      .where('merchantId', '=', merchantId)
      .execute();
  }
}
