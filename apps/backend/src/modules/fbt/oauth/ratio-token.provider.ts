import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { RatioOAuthCreds, RatioOAuthHttp } from '../../../core/oauth/ratio-oauth.http';
import type { FbtDatabase } from '../db/types';
import { FBT_DB_TOKEN } from '../kysely.module';
import { FBT_CRYPTO, FBT_RATIO_OAUTH_CREDS, FBT_RATIO_OAUTH_HTTP } from '../tokens';

/** Refresh when the stored access token has less than this much life left. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Resolves a usable Ratio merchant access token for catalog calls.
 *
 * `core`'s `OAuthService` stores tokens at install and exposes no getter, so each
 * vendor that calls the Ratio API owns a provider like this one (`wizzy`,
 * `loyalty`, `google`, `meta`, `rp` all have the equivalent).
 *
 * Ratio refresh tokens are SINGLE-USE: a refresh returns a new access token AND
 * a new refresh token, and the old refresh token dies immediately. Both are
 * re-encrypted and persisted in the same update as the new expiry — dropping the
 * rotated refresh token breaks the merchant permanently once the access token
 * lapses, recoverable only by reinstalling.
 */
@Injectable()
export class FbtRatioTokenProvider {
  constructor(
    @Inject(FBT_DB_TOKEN) private readonly handle: KyselyClient<FbtDatabase>,
    @Inject(FBT_CRYPTO) private readonly crypto: CryptoService,
    @Inject(FBT_RATIO_OAUTH_HTTP) private readonly http: RatioOAuthHttp,
    @Inject(FBT_RATIO_OAUTH_CREDS) private readonly creds: RatioOAuthCreds,
  ) {}

  async getAccessToken(merchantId: string): Promise<string> {
    const row = await this.handle.db
      .selectFrom('oauth_tokens')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();

    if (!row) {
      throw new Error(`no Ratio oauth_tokens row for merchant ${merchantId}`);
    }

    // A null expiry is treated as "must refresh", not "still valid" — sending a
    // possibly-dead token upstream surfaces as an opaque 401 much later.
    const stillValid =
      row.expiresAt && new Date(row.expiresAt).getTime() - Date.now() > EXPIRY_SKEW_MS;
    if (stillValid) return this.crypto.decrypt(row.accessTokenEnc);

    const refreshed = await this.http.refresh(this.crypto.decrypt(row.refreshTokenEnc), {
      clientId: this.creds.clientId,
      clientSecret: this.creds.clientSecret,
    });

    await this.handle.db
      .updateTable('oauth_tokens')
      .set({
        accessTokenEnc: this.crypto.encrypt(refreshed.accessToken),
        // The rotated refresh token MUST be stored — the old one is already dead.
        refreshTokenEnc: this.crypto.encrypt(refreshed.refreshToken),
        expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .where('merchantId', '=', merchantId)
      .execute();

    return refreshed.accessToken;
  }
}
