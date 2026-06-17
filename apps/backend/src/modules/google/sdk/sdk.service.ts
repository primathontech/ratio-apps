import { readFile } from 'node:fs/promises';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { GoogleConfig } from '@ratio-app/shared/schemas/google-config';
import type { FastifyReply } from 'fastify';
import { resolvePixelPath } from '../../../core/common/resolve-pixel-path';
import { safeInlineJson } from '../../../core/common/safe-inline-json';
import type { MerchantsService } from '../../../core/merchants/merchants.service';
import { GoogleConfigService } from '../config/config.service';
import type { GoogleDatabase } from '../db/types';
import { GOOGLE_MERCHANTS } from '../tokens';

/**
 * Serves the per-merchant combined GA4 + Google Ads pixel JS for the script-tag
 * delivery path (the Web-Pixels-API-independent fallback). It validates the
 * merchant + that at least one client-side pixel is configured, then prepends a
 * `window.__GOOGLE_RATIO_CONFIG__` prelude (built from the DB config) to the
 * static `google-pixel.js` bundle.
 */
@Injectable()
export class GoogleSdkService {
  private readonly logger = new Logger(GoogleSdkService.name);
  private pixel: string | null = null;

  constructor(
    private readonly configs: GoogleConfigService,
    @Inject(GOOGLE_MERCHANTS) private readonly merchants: MerchantsService<GoogleDatabase>,
  ) {}

  /**
   * Renders the per-merchant pixel JS:
   *   1. Verify merchant exists and is active (uninstalled merchants serve 404)
   *   2. Verify Google config is filled in (apiKey + host)
   *   3. Read static/google-pixel.js (cached after first read)
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
    let config: GoogleConfig;
    try {
      config = await this.configs.getByMerchantId(merchantId);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new NotFoundException({
          message: 'merchant has not configured Google yet',
          error_code: 'CONFIG_INCOMPLETE',
        });
      }
      throw err;
    }
    const ga4Ready = config.ga4Enabled && !!config.ga4MeasurementId;
    const adsReady = config.adsEnabled && !!config.adsConversionId;
    if (!ga4Ready && !adsReady) {
      throw new NotFoundException({
        message: 'merchant has no client-side Google pixel configured yet',
        error_code: 'CONFIG_INCOMPLETE',
      });
    }
    const pixel = await this.loadPixel();
    // Only reached on success — error paths above throw, so the cache
    // header is never attached to 404 / 503 responses.
    reply.header('Cache-Control', 'public, max-age=300');
    return `${this.buildPrelude(merchantId, config)}\n${pixel}`;
  }

  /** Build the `window.__GOOGLE_RATIO_CONFIG__` prelude consumed by google-pixel.js. */
  buildPrelude(merchantId: string, config: GoogleConfig): string {
    const payload = {
      merchantId,
      // GA4 fans out (isolated:false) so Ads remarketing / enhanced conversions work.
      ga4:
        config.ga4Enabled && config.ga4MeasurementId
          ? { measurementId: config.ga4MeasurementId, isolated: false }
          : null,
      // Ads owns its own conversions via send_to: conversionId/label.
      ads:
        config.adsEnabled && config.adsConversionId
          ? {
              conversionId: config.adsConversionId,
              conversionLabel: config.adsConversionLabel ?? undefined,
            }
          : null,
      enhancedConversions: config.enhancedConversionsEnabled,
    };
    return `window.__GOOGLE_RATIO_CONFIG__ = ${safeInlineJson(payload)};`;
  }

  private async loadPixel(): Promise<string> {
    if (this.pixel !== null) return this.pixel;
    const path = resolvePixelPath('google', __dirname);
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
