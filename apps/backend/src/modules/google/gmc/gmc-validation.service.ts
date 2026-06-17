import { Inject, Injectable, Logger } from '@nestjs/common';
import { GOOGLE_OAUTH_HTTP } from '../tokens';
import type { GoogleOAuthHttp } from '../google-oauth/google-oauth.http';
import { ContentApiClient } from './content-api.client';

const CONTENT_SCOPE = 'https://www.googleapis.com/auth/content';

/**
 * Validates a GMC service-account key by minting an access token from it and
 * making a cheap, read-only Content API call against the merchant's GMC account.
 * Used by `POST /google/api/validate-gmc` so the merchant gets immediate
 * feedback before saving manual config.
 */
@Injectable()
export class GmcValidationService {
  private readonly logger = new Logger(GmcValidationService.name);

  constructor(@Inject(GOOGLE_OAUTH_HTTP) private readonly http: GoogleOAuthHttp) {}

  async validate(
    keyJson: string,
    gmcMerchantId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const token = await this.http.serviceAccountToken(keyJson, [CONTENT_SCOPE]);
      const client = new ContentApiClient({
        merchantId: gmcMerchantId,
        getAccessToken: async () => token,
      });
      // A bounded list call is enough to prove the key + account are valid.
      await client.listProducts();
      return { ok: true };
    } catch (err) {
      // Never echo the key or token; log only a generic failure.
      this.logger.warn({ msg: 'gmc validation failed', gmcMerchantId });
      return { ok: false, error: err instanceof Error ? err.message : 'validation failed' };
    }
  }
}
