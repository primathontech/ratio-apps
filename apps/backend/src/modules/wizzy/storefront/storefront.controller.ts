import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import type { WizzyStorefrontConfig } from '@ratio-app/shared/schemas/wizzy-search';
import { StorefrontConfigService } from './storefront-config.service';

/** The three built SDK bundles served from `packages/wizzy-sdk/dist`. */
type SdkBundle = 'wizzy-loader.js' | 'wizzy-widget.js' | 'wizzy-results.js';

/**
 * PUBLIC storefront endpoints (no merchant guard) — these are loaded directly
 * by merchant storefronts in the browser, so every response sets a permissive
 * CORS header.
 *
 * Serves the three built SDK bundles from `packages/wizzy-sdk/dist` (cached in
 * memory after first read) plus the redacted public config for a merchant.
 */
@Controller('wizzy/sdk')
export class StorefrontController {
  /** First-read cache of bundle contents, keyed by file name. */
  private readonly bundleCache = new Map<string, string>();

  constructor(private readonly cfg: StorefrontConfigService) {}

  @Get('wizzy-loader.js')
  @Header('content-type', 'text/javascript; charset=utf-8')
  @Header('access-control-allow-origin', '*')
  @Header('cache-control', 'public, max-age=3600')
  loader(): string {
    return this.readBundle('wizzy-loader.js');
  }

  @Get('wizzy-widget.js')
  @Header('content-type', 'text/javascript; charset=utf-8')
  @Header('access-control-allow-origin', '*')
  @Header('cache-control', 'public, max-age=3600')
  widget(): string {
    return this.readBundle('wizzy-widget.js');
  }

  @Get('wizzy-results.js')
  @Header('content-type', 'text/javascript; charset=utf-8')
  @Header('access-control-allow-origin', '*')
  @Header('cache-control', 'public, max-age=3600')
  results(): string {
    return this.readBundle('wizzy-results.js');
  }

  @Get('config/:merchantId')
  @Header('access-control-allow-origin', '*')
  @Header('cache-control', 'no-store')
  async config(@Param('merchantId') merchantId: string): Promise<WizzyStorefrontConfig> {
    return this.cfg.publicConfig(merchantId);
  }

  /**
   * Resolve the built SDK dist directory. Mirrors the runtime path-resolution
   * pattern in `configure-app.ts`: `cwd` is the repo root in dev, PM2, and
   * Docker, and the SDK build lives at `<root>/packages/wizzy-sdk/dist`.
   * `WIZZY_SDK_DIST` overrides for non-standard layouts.
   */
  private distDir(): string {
    return process.env.WIZZY_SDK_DIST ?? resolve(process.cwd(), 'packages/wizzy-sdk/dist');
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
      throw new NotFoundException(`SDK bundle not found: ${name}. Build @ratio-app/wizzy-sdk.`);
    }
  }
}
