import { readFile } from 'node:fs/promises';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { TemplateConfig } from '@ratio-app/shared/schemas/_template-config';
import { buildSdkEventNameMap } from '@ratio-app/shared/schemas/event-map';
import type { FastifyReply } from 'fastify';
import { resolvePixelPath } from '../../../core/common/resolve-pixel-path';
import { safeInlineJson } from '../../../core/common/safe-inline-json';
import type { MerchantsService } from '../../../core/merchants/merchants.service';
import { TemplateConfigService } from '../config/config.service';
import type { TemplateDatabase } from '../db/types';
import { TEMPLATE_MERCHANTS } from '../tokens';

// TEMPLATE: This SDK service demonstrates the per-merchant "config + pixel"
// delivery pattern (validate merchant -> load config -> render a per-merchant
// JS payload). For a real vendor, replace `render()`/`buildPrelude()` with the
// calls your vendor SDK actually needs (e.g. forwarding events to an external
// API) and update the config fields referenced here to match your vendor's
// `_template-config` schema in packages/shared.
@Injectable()
export class TemplateSdkService {
  private readonly logger = new Logger(TemplateSdkService.name);
  private pixel: string | null = null;

  constructor(
    private readonly configs: TemplateConfigService,
    @Inject(TEMPLATE_MERCHANTS) private readonly merchants: MerchantsService<TemplateDatabase>,
  ) {}

  /**
   * Renders the per-merchant pixel JS:
   *   1. Verify merchant exists and is active (uninstalled merchants serve 404)
   *   2. Verify Template config is filled in (apiKey + host)
   *   3. Read static/_template-pixel.js (cached after first read)
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
    let config: TemplateConfig;
    try {
      config = await this.configs.getByMerchantId(merchantId);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new NotFoundException({
          message: 'merchant has not configured Template yet',
          error_code: 'CONFIG_INCOMPLETE',
        });
      }
      throw err;
    }
    if (!config.apiKey) {
      throw new NotFoundException({
        message: 'merchant has not configured Template yet',
        error_code: 'CONFIG_INCOMPLETE',
      });
    }
    const pixel = await this.loadPixel();
    // Only reached on success — error paths above throw, so the cache
    // header is never attached to 404 / 503 responses.
    reply.header('Cache-Control', 'public, max-age=300');
    return `${this.buildPrelude(merchantId, config)}\n${pixel}`;
  }

  private buildPrelude(merchantId: string, config: TemplateConfig): string {
    const eventNameMap = buildSdkEventNameMap(config.events);
    const payload = {
      apiKey: config.apiKey,
      host: config.host,
      debug: config.debug,
      merchantId,
      eventNameMap,
    };
    return `window.__TEMPLATE_RATIO_CONFIG__ = ${safeInlineJson(payload)};`;
  }

  private async loadPixel(): Promise<string> {
    if (this.pixel !== null) return this.pixel;
    const path = resolvePixelPath('_template', __dirname);
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
