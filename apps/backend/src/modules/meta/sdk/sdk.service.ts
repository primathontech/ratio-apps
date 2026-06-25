import { readFile } from 'node:fs/promises';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { buildSdkEventNameMap } from '@ratio-app/shared/schemas/event-map';
import type { MetaConfig } from '@ratio-app/shared/schemas/meta-config';
import type { FastifyReply } from 'fastify';
import { resolvePixelPath } from '../../../core/common/resolve-pixel-path';
import { safeInlineJson } from '../../../core/common/safe-inline-json';
import type { MerchantsService } from '../../../core/merchants/merchants.service';
import { MetaConfigService } from '../config/config.service';
import type { MetaDatabase } from '../db/types';
import { META_MERCHANTS } from '../tokens';

// META: This SDK service demonstrates the per-merchant "config + pixel"
// delivery pattern (validate merchant -> load config -> render a per-merchant
// JS payload). For a real vendor, replace `render()`/`buildPrelude()` with the
// calls your vendor SDK actually needs (e.g. forwarding events to an external
// API) and update the config fields referenced here to match your vendor's
// `meta-config` schema in packages/shared.
@Injectable()
export class MetaSdkService {
  private readonly logger = new Logger(MetaSdkService.name);
  private pixel: string | null = null;

  constructor(
    private readonly configs: MetaConfigService,
    @Inject(META_MERCHANTS) private readonly merchants: MerchantsService<MetaDatabase>,
  ) {}

  /**
   * Renders the per-merchant pixel JS:
   *   1. Verify merchant exists and is active (uninstalled merchants serve 404)
   *   2. Verify Meta config is filled in (apiKey + host)
   *   3. Read static/meta-pixel.js (cached after first read)
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
  async render(merchantId: string, reply: FastifyReply, baseUrl: string): Promise<string> {
    const merchant = await this.merchants.findById(merchantId);
    if (!merchant?.isActive) {
      throw new NotFoundException({
        message: 'merchant not installed or uninstalled',
        error_code: 'MERCHANT_INACTIVE',
      });
    }
    let config: MetaConfig;
    try {
      config = await this.configs.getByMerchantId(merchantId);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new NotFoundException({
          message: 'merchant has not configured Meta yet',
          error_code: 'CONFIG_INCOMPLETE',
        });
      }
      throw err;
    }
    if (!config.pixelId) {
      throw new NotFoundException({
        message: 'merchant has not configured Meta yet',
        error_code: 'CONFIG_INCOMPLETE',
      });
    }
    const pixel = await this.loadPixel();
    // Only reached on success — error paths above throw, so the cache
    // header is never attached to 404 / 503 responses.
    reply.header('Cache-Control', 'public, max-age=300');
    return `${this.buildPrelude(merchantId, config, baseUrl)}\n${pixel}`;
  }

  async getEventMap(merchantId: string) {
    const merchant = await this.merchants.findById(merchantId);
    if (!merchant?.isActive) {
      throw new NotFoundException({
        message: 'merchant not installed or uninstalled',
        error_code: 'MERCHANT_INACTIVE',
      });
    }
    let config: MetaConfig;
    try {
      config = await this.configs.getByMerchantId(merchantId);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new NotFoundException({
          message: 'merchant has not configured Meta yet',
          error_code: 'CONFIG_INCOMPLETE',
        });
      }
      throw err;
    }
    // Return the event map (merchant's configured event name mappings)
    return { events: config.events, merchantId };
  }

  private buildPrelude(merchantId: string, config: MetaConfig, baseUrl: string): string {
    const eventNameMap = buildSdkEventNameMap(config.events);
    // SECURITY: only browser-safe fields here. The CAPI access token is
    // SECRET and is NEVER placed in the prelude — server-side CAPI dispatch
    // (Call C) reads it from the DB. The browser posts Call B to `capiPath`.
    //
    // capiPath MUST be absolute: the SDK runs on the merchant's storefront,
    // a DIFFERENT origin than this backend. A relative path would post Call B
    // into the storefront itself (404), not here. `baseUrl` is this backend's
    // public origin, derived from the request the SDK was served on.
    const capiPath = `${baseUrl}/meta/api/v1/capi/${merchantId}`;
    const isDev = process.env.NODE_ENV === 'development';

    // debugMockBase: in dev, Call A (browser pixel) stubs post here instead
    // of connect.facebook.net. Must match FACEBOOK_CAPI_BASE_URL in .env.
    const debugMockBase = isDev ? (process.env.FACEBOOK_CAPI_BASE_URL ?? 'http://localhost:8081') : undefined;

    const payload = {
      pixelId: config.pixelId,
      capiPath,
      dataSharingLevel: config.dataSharingLevel,
      productIdType: config.productIdType,
      debug: config.debug,
      merchantId,
      eventNameMap,
      ...(debugMockBase ? { debugMockBase } : {}),
      ...(process.env.RATIO_META_CAPI_HMAC_SECRET ? { capiHmacSecret: process.env.RATIO_META_CAPI_HMAC_SECRET } : {}),
    };
    return `window.__META_RATIO_CONFIG__ = ${safeInlineJson(payload)};`;
  }

  private async loadPixel(): Promise<string> {
    if (this.pixel !== null) return this.pixel;
    const path = resolvePixelPath('meta', __dirname);
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
