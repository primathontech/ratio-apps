import { Inject, Injectable, Logger } from '@nestjs/common';
import type { GoogleDiscoverResponse } from '@ratio-app/shared/schemas/google-config';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { GoogleDatabase } from '../db/types';
import { ContentApiClient } from '../gmc/content-api.client';
import { Ga4AdminClient } from '../ga4/ga4-admin.client';
import { GoogleAuthService } from '../google-oauth/google-auth.service';
import { GOOGLE_DB_TOKEN } from '../kysely.module';

const OAUTH_REQUIRED = 'Connect a Google account (OAuth) to auto-detect.';

/**
 * Reads a merchant's GA4 web-stream Measurement IDs and GMC account IDs from
 * Google using their connected OAuth token, so the admin can auto-fill the
 * config form. OAuth-only (the manual/service-account path has no Analytics
 * access) and partial-tolerant: a failure in one integration never fails the
 * other or the whole call. Never logs tokens.
 */
@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);

  constructor(
    @Inject(GOOGLE_DB_TOKEN) private readonly handle: KyselyClient<GoogleDatabase>,
    private readonly auth: GoogleAuthService,
  ) {}

  async discover(merchantId: string): Promise<GoogleDiscoverResponse> {
    const config = await this.handle.db
      .selectFrom('google_configs')
      .select(['connectionMethod'])
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();

    if (config?.connectionMethod !== 'oauth') {
      return {
        ga4: { streams: [], error: OAUTH_REQUIRED },
        gmc: { accounts: [], error: OAUTH_REQUIRED },
      };
    }

    const getAccessToken = () => this.auth.getAccessToken(merchantId);
    const [ga4, gmc] = await Promise.all([
      this.discoverGa4(getAccessToken).catch((err) => this.failGa4(err)),
      this.discoverGmc(getAccessToken).catch((err) => this.failGmc(err)),
    ]);
    return { ga4, gmc };
  }

  private async discoverGa4(
    getAccessToken: () => Promise<string>,
  ): Promise<GoogleDiscoverResponse['ga4']> {
    const streams = await new Ga4AdminClient({ getAccessToken }).listWebMeasurementIds();
    return { streams };
  }

  private async discoverGmc(
    getAccessToken: () => Promise<string>,
  ): Promise<GoogleDiscoverResponse['gmc']> {
    // authinfo discovers the account id, so the instance merchantId is unused here.
    const client = new ContentApiClient({ merchantId: '', getAccessToken });
    const accounts = await client.getAuthinfo();
    return { accounts };
  }

  private failGa4(err: unknown): GoogleDiscoverResponse['ga4'] {
    this.logger.warn({ msg: 'ga4 discovery failed' });
    return { streams: [], error: err instanceof Error ? err.message : 'GA4 discovery failed' };
  }

  private failGmc(err: unknown): GoogleDiscoverResponse['gmc'] {
    this.logger.warn({ msg: 'gmc discovery failed' });
    return { accounts: [], error: err instanceof Error ? err.message : 'GMC discovery failed' };
  }
}
