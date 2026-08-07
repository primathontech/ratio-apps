import { readFile } from 'node:fs/promises';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CLEVERTAP_CHARGED_EVENT,
  CLEVERTAP_REGIONS,
  type ClevertapRegion,
} from '@ratio-app/shared/constants/clevertap-events';
import type { ClevertapConfigOutput } from '@ratio-app/shared/schemas/clevertap-config';
import { buildSdkEventNameMap } from '@ratio-app/shared/schemas/event-map';
import type { FastifyReply } from 'fastify';
import { resolvePixelPath } from '../../../core/common/resolve-pixel-path';
import { safeInlineJson } from '../../../core/common/safe-inline-json';
import type { MerchantsService } from '../../../core/merchants/merchants.service';
import { ClevertapConfigService } from '../config/config.service';
import type { ClevertapDatabase } from '../db/types';
import { CLEVERTAP_APP_ENABLED, CLEVERTAP_MERCHANTS } from '../tokens';

const INERT_PIXEL_BODY = '/* CleverTap disabled for this merchant */';

@Injectable()
export class ClevertapSdkService {
  private readonly logger = new Logger(ClevertapSdkService.name);
  private pixel: string | null = null;

  constructor(
    private readonly configs: ClevertapConfigService,
    @Inject(CLEVERTAP_MERCHANTS) private readonly merchants: MerchantsService<ClevertapDatabase>,
    @Optional() @Inject(CLEVERTAP_APP_ENABLED) private readonly platformEnabled = true,
  ) {}

  async render(merchantId: string, reply: FastifyReply): Promise<string> {
    const merchant = await this.merchants.findById(merchantId);
    if (!merchant?.isActive) {
      throw new NotFoundException({
        message: 'merchant not installed or uninstalled',
        error_code: 'MERCHANT_INACTIVE',
      });
    }

    let config: ClevertapConfigOutput;
    try {
      config = await this.configs.getByMerchantId(merchantId);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new NotFoundException({
          message: 'merchant has not configured CleverTap yet',
          error_code: 'CONFIG_INCOMPLETE',
        });
      }
      throw err;
    }
    if (!config.accountId) {
      throw new NotFoundException({
        message: 'merchant has not configured CleverTap yet',
        error_code: 'CONFIG_INCOMPLETE',
      });
    }

    if (!this.platformEnabled || !config.clevertapEnabled) {
      reply.header('Cache-Control', 'no-store');
      return INERT_PIXEL_BODY;
    }

    const prelude = this.buildPrelude(merchantId, config);
    const pixel = await this.loadPixel();
    reply.header('Cache-Control', 'public, max-age=300');
    return `${prelude}\n${pixel}`;
  }

  private buildPrelude(merchantId: string, config: ClevertapConfigOutput): string {
    const region = CLEVERTAP_REGIONS[config.region as ClevertapRegion];
    if (!region) {
      throw new NotFoundException({
        message: 'merchant clevertap config has unknown region',
        error_code: 'CONFIG_INVALID_REGION',
      });
    }
    const eventNameMap = buildSdkEventNameMap(config.events);
    const serverOwnsCharged = config.chargedSource === 'server';
    if (serverOwnsCharged) {
      for (const [key, name] of Object.entries(eventNameMap)) {
        if (name === CLEVERTAP_CHARGED_EVENT) {
          delete eventNameMap[key as keyof typeof eventNameMap];
        }
      }
    }
    const payload = {
      accountId: config.accountId,
      region: config.region,
      apiHost: region.apiHost,
      debug: config.debug,
      merchantId,
      eventNameMap,
    };
    return `window.__CLEVERTAP_RATIO_CONFIG__ = ${safeInlineJson(payload)};`;
  }

  private async loadPixel(): Promise<string> {
    if (this.pixel !== null) return this.pixel;
    const path = resolvePixelPath('clevertap', __dirname);
    try {
      this.pixel = await readFile(path, 'utf8');
      this.logger.log({ msg: 'pixel loaded', path, bytes: this.pixel.length });
      return this.pixel;
    } catch (err) {
      this.logger.error({ msg: 'pixel file missing', path, err });
      throw new ServiceUnavailableException({
        message: 'pixel asset missing',
        error_code: 'PIXEL_MISSING',
      });
    }
  }
}
