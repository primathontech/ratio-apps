import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { GoogleDatabase } from '../db/types';
import { GOOGLE_CRYPTO, GOOGLE_WEB_PIXELS } from '../tokens';
import { GOOGLE_DB_TOKEN } from '../kysely.module';
import { WebPixelsApi, WebPixelsApiError } from './web-pixels.api';

type PixelStatus = 'active' | 'pending_api' | 'error' | 'disabled';

/**
 * Registers the GA4 / Google Ads pixels via the (Draft) Web Pixels API and
 * records the resulting status on `google_configs`. The call is GUARDED: when
 * the API is unavailable the merchant's pixel status becomes `pending_api`
 * (NOT an error) so the rest of the app — and the script-tag delivery path —
 * keep working. A scope/token problem records `error`.
 */
@Injectable()
export class PixelRegistrationService {
  private readonly logger = new Logger(PixelRegistrationService.name);

  constructor(
    @Inject(GOOGLE_DB_TOKEN) private readonly handle: KyselyClient<GoogleDatabase>,
    @Inject(GOOGLE_CRYPTO) private readonly crypto: CryptoService,
    @Inject(GOOGLE_WEB_PIXELS) private readonly api: WebPixelsApi,
  ) {}

  /** Attempt to register both configured pixels for a merchant. Never throws. */
  async registerPixels(merchantId: string): Promise<void> {
    const config = await this.handle.db
      .selectFrom('google_configs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (!config) return;

    const tokenRow = await this.handle.db
      .selectFrom('oauth_tokens')
      .select(['accessTokenEnc'])
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (!tokenRow) return;
    const accessToken = this.crypto.decrypt(tokenRow.accessTokenEnc);

    if (config.ga4Enabled && config.ga4MeasurementId) {
      await this.registerOne(merchantId, accessToken, 'ga4', {
        measurementId: config.ga4MeasurementId,
        isolated: false,
      });
    }
    if (config.adsEnabled && config.adsConversionId) {
      await this.registerOne(merchantId, accessToken, 'google-ads', {
        conversionId: config.adsConversionId,
        conversionLabel: config.adsConversionLabel ?? null,
        enhancedConversions: Boolean(config.enhancedConversionsEnabled),
      });
    }
  }

  private async registerOne(
    merchantId: string,
    accessToken: string,
    type: 'ga4' | 'google-ads',
    settings: Record<string, unknown>,
  ): Promise<void> {
    const isGa4 = type === 'ga4';
    try {
      const { pixelId } = await this.api.register(accessToken, { type, settings });
      await this.setStatus(merchantId, isGa4, 'active', pixelId);
    } catch (err) {
      const status: PixelStatus =
        err instanceof WebPixelsApiError && err.kind === 'unavailable' ? 'pending_api' : 'error';
      if (status === 'pending_api') {
        this.logger.log({ msg: 'web pixels API unavailable — marking pending_api', merchantId, type });
      } else {
        this.logger.warn({ msg: 'pixel registration failed', merchantId, type, err: `${err}` });
      }
      await this.setStatus(merchantId, isGa4, status, null);
    }
  }

  private async setStatus(
    merchantId: string,
    isGa4: boolean,
    status: PixelStatus,
    pixelId: string | null,
  ): Promise<void> {
    const patch = isGa4
      ? { ga4PixelStatus: status, ...(pixelId ? { ga4PixelId: pixelId } : {}) }
      : { adsPixelStatus: status, ...(pixelId ? { adsPixelId: pixelId } : {}) };
    await this.handle.db
      .updateTable('google_configs')
      .set({ ...patch, updatedAt: sql`CURRENT_TIMESTAMP(3)` } as never)
      .where('merchantId', '=', merchantId)
      .execute();
  }
}
