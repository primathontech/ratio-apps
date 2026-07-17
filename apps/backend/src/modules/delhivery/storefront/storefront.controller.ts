import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Controller, Get, Inject, NotFoundException, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { MerchantIdPipe } from '../../../core/common/pipes/merchant-id.pipe';
import { safeInlineJson } from '../../../core/common/safe-inline-json';
import type { MerchantsService } from '../../../core/merchants/merchants.service';
import type { DelhiveryDatabase } from '../db/types';
import { DELHIVERY_MERCHANTS } from '../tokens';

/** Keep in sync with `packages/delhivery-sdk/src/version.ts` (cache-busts the widget URL). */
const SDK_VERSION = '0.1.0';

/** The two built SDK bundles served from `packages/delhivery-sdk/dist`. */
type SdkBundle = 'delhivery-loader.js' | 'delhivery-widget.js';

/**
 * PUBLIC storefront-SDK endpoints (no merchant guard) — loaded directly by
 * merchant storefronts / Kwik Checkout in the browser, so every response sets
 * a permissive CORS header. Mirrors the wizzy `StorefrontController` (bundle
 * serving) + the google `sdk.controller` (per-merchant `<script>` with a
 * config prelude).
 *
 * - `GET /delhivery/sdk/<merchantId>.js` — the merchant pastes this one
 *   script tag; it serves the built loader IIFE prefixed with a
 *   `window.__DELHIVERY__` prelude (PUBLIC values only: merchant id + SDK
 *   version — the loader derives the API base from its own script origin;
 *   the merchant's Delhivery token NEVER appears here).
 * - `GET /delhivery/sdk/delhivery-widget.js` — the shared, lazily-injected
 *   `<delhivery-serviceability>` ESM bundle.
 *
 * Both routes use `@Res() reply` and `reply.send()` to bypass the global
 * ResponseInterceptor, which would otherwise wrap the raw JS in a
 * `{ status_code, message, data }` envelope and break the SDK.
 */
@Controller('delhivery/sdk')
export class DelhiveryStorefrontController {
  /** First-read cache of bundle contents, keyed by file name. */
  private readonly bundleCache = new Map<string, string>();

  constructor(
    @Inject(DELHIVERY_MERCHANTS) private readonly merchants: MerchantsService<DelhiveryDatabase>,
  ) {}

  /** Shared widget bundle — static route, wins over `:merchantId.js` below. */
  @Get('delhivery-widget.js')
  widget(@Res() reply: FastifyReply): void {
    reply
      .header('content-type', 'application/javascript; charset=utf-8')
      .header('access-control-allow-origin', '*')
      .header('cache-control', 'public, max-age=3600')
      .send(this.readBundle('delhivery-widget.js'));
  }

  /**
   * Per-merchant loader. `MerchantIdPipe` validates `:merchantId` against
   * `^[A-Za-z0-9_-]{1,128}$` before any DB lookup (path-traversal / length
   * attacks on an unauthenticated route).
   *
   * NOTE: `Cache-Control` is set on the success path only — a route-level
   * `@Header()` would attach it to the 404 (MERCHANT_INACTIVE) responses too,
   * poisoning CDNs during installation races (same reasoning as google's
   * pixel route).
   */
  @Get(':merchantId.js')
  async loader(
    @Param('merchantId', MerchantIdPipe) merchantId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const merchant = await this.merchants.findById(merchantId);
    if (!merchant?.isActive) {
      throw new NotFoundException({
        message: 'merchant not installed or uninstalled',
        error_code: 'MERCHANT_INACTIVE',
      });
    }
    const bundle = this.readBundle('delhivery-loader.js');
    const prelude = `window.__DELHIVERY__ = ${safeInlineJson({ merchantId, version: SDK_VERSION })};`;
    reply
      .header('content-type', 'application/javascript; charset=utf-8')
      .header('access-control-allow-origin', '*')
      .header('cache-control', 'public, max-age=300')
      .send(`${prelude}\n${bundle}`);
  }

  /**
   * Resolve the built SDK dist directory. Mirrors the wizzy storefront
   * controller: `cwd` is the repo root in dev, PM2, and Docker, and the SDK
   * build lives at `<root>/packages/delhivery-sdk/dist`. `DELHIVERY_SDK_DIST`
   * overrides for non-standard layouts (and unit tests).
   */
  private distDir(): string {
    return process.env.DELHIVERY_SDK_DIST ?? resolve(process.cwd(), 'packages/delhivery-sdk/dist');
  }

  /** Read (and memoize) a built bundle; 404 if it hasn't been built. */
  private readBundle(name: SdkBundle): string {
    const cached = this.bundleCache.get(name);
    if (cached !== undefined) {
      return cached;
    }
    try {
      const contents = readFileSync(resolve(this.distDir(), name), 'utf8');
      this.bundleCache.set(name, contents);
      return contents;
    } catch {
      throw new NotFoundException(`SDK bundle not found: ${name}. Build @ratio-app/delhivery-sdk.`);
    }
  }
}
