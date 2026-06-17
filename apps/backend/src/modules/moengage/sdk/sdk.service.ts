import { readFile } from 'node:fs/promises';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  MOENGAGE_DATA_CENTERS,
  type MoEngageDataCenter,
} from '@ratio-app/shared/constants/moengage-events';
import { buildSdkEventNameMap } from '@ratio-app/shared/schemas/event-map';
import type { MoEngageConfig } from '@ratio-app/shared/schemas/moengage-config';
import type { FastifyReply } from 'fastify';
import { resolvePixelPath } from '../../../core/common/resolve-pixel-path';
import { safeInlineJson } from '../../../core/common/safe-inline-json';
import type { MerchantsService } from '../../../core/merchants/merchants.service';
import { MoengageConfigService } from '../config/config.service';
import type { MoengageDatabase } from '../db/types';
import { MOENGAGE_MERCHANTS } from '../tokens';

@Injectable()
export class MoengageSdkService {
  private readonly logger = new Logger(MoengageSdkService.name);
  private pixel: string | null = null;

  constructor(
    private readonly configs: MoengageConfigService,
    @Inject(MOENGAGE_MERCHANTS)
    private readonly merchants: MerchantsService<MoengageDatabase>,
  ) {}

  /**
   * Renders the per-merchant pixel JS:
   *   1. Verify merchant exists and is active (uninstalled merchants serve 404)
   *   2. Verify MoEngage config is filled in (appId)
   *   3. Read static/moengage-pixel.js (cached after first read)
   *   4. Prepend the config prelude — same file body for every merchant
   *
   * Finding #5: await the two lookups sequentially. If we used Promise.all, a
   * missing config row (CONFIG_NOT_FOUND) would race the merchant lookup and
   * could mask MERCHANT_INACTIVE — the merchant check must always win.
   *
   * The 5-minute `Cache-Control` header is set HERE (on the success path)
   * rather than via a route-level `@Header()` decorator: applying the
   * header at the route would cause Fastify to attach it to 404 / 503
   * error responses too, poisoning CDNs during installation races.
   */
  async render(merchantId: string, reply: FastifyReply): Promise<string> {
    const merchant = await this.merchants.findById(merchantId);
    if (!merchant?.isActive) {
      throw new NotFoundException({
        message: 'merchant not installed or uninstalled',
        error_code: 'MERCHANT_INACTIVE',
      });
    }
    let config: MoEngageConfig;
    try {
      config = await this.configs.getByMerchantId(merchantId);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new NotFoundException({
          message: 'merchant has not configured MoEngage yet',
          error_code: 'CONFIG_INCOMPLETE',
        });
      }
      throw err;
    }
    if (!config.appId) {
      throw new NotFoundException({
        message: 'merchant has not configured MoEngage yet',
        error_code: 'CONFIG_INCOMPLETE',
      });
    }
    const pixel = await this.loadPixel();
    // Only reached on success — error paths above throw, so the cache
    // header is never attached to 404 / 503 responses.
    reply.header('Cache-Control', 'public, max-age=300');
    return `${this.buildPrelude(merchantId, config)}\n${pixel}`;
  }

  private buildPrelude(merchantId: string, config: MoEngageConfig): string {
    const eventNameMap = buildSdkEventNameMap(config.events);
    // Finding #8: if `config.dataCenter` is not a known cluster key, throw
    // explicitly rather than silently falling back to DC_1. The PUT schema
    // already validates against MOENGAGE_DATA_CENTERS, so this only fires on
    // legacy rows or a future enum change without a backfill.
    const dc = MOENGAGE_DATA_CENTERS[config.dataCenter as MoEngageDataCenter];
    if (!dc) {
      throw new NotFoundException({
        message: 'merchant moengage config has unknown data center',
        error_code: 'CONFIG_INVALID_DC',
      });
    }
    const payload = {
      appId: config.appId,
      cluster: config.dataCenter,
      apiHost: dc.dashboard,
      debug: config.debug,
      merchantId,
      eventNameMap,
      swPath: config.swPath,
    };
    return `window.__MOENGAGE_RATIO_CONFIG__ = ${safeInlineJson(payload)};`;
  }

  private async loadPixel(): Promise<string> {
    if (this.pixel !== null) return this.pixel;
    const path = resolvePixelPath('moengage', __dirname);
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
