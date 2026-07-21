import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { StorefrontConfigService } from './storefront-config.service';

/** The two built SDK bundles served from `packages/loyalty-sdk/dist`. */
type SdkBundle = 'loyalty-loader.js' | 'loyalty-claim.js';

/**
 * PUBLIC storefront endpoints (no merchant guard) — these are loaded directly
 * by merchant storefronts in the browser, so every response sets a permissive
 * CORS header.
 *
 * Serves the built SDK bundles from `packages/loyalty-sdk/dist` (cached in
 * memory after first read) plus the redacted public config for a merchant.
 *
 * All routes use `@Res() reply: FastifyReply` and send via `reply.send()` to
 * bypass the global ResponseInterceptor, which would otherwise wrap the raw
 * JS/JSON in a `{ status_code, message, data }` envelope and break the SDK.
 */
@Controller('loyalty/sdk')
export class StorefrontController {
  /** First-read cache of bundle contents, keyed by file name. */
  private readonly bundleCache = new Map<string, string>();

  constructor(private readonly cfg: StorefrontConfigService) {}

  @Get('loyalty-loader.js')
  loader(@Res() reply: FastifyReply): void {
    reply
      .header('content-type', 'text/javascript; charset=utf-8')
      .header('access-control-allow-origin', '*')
      .header('cache-control', 'public, max-age=3600')
      .send(this.readBundle('loyalty-loader.js'));
  }

  @Get('loyalty-claim.js')
  claim(@Res() reply: FastifyReply): void {
    reply
      .header('content-type', 'text/javascript; charset=utf-8')
      .header('access-control-allow-origin', '*')
      .header('cache-control', 'public, max-age=3600')
      .send(this.readBundle('loyalty-claim.js'));
  }

  @Get('config/:merchantId')
  async config(@Param('merchantId') merchantId: string, @Res() reply: FastifyReply): Promise<void> {
    reply
      .header('access-control-allow-origin', '*')
      .header('cache-control', 'no-store')
      .send(await this.cfg.publicConfig(merchantId));
  }

  /**
   * Resolve the built SDK dist directory. `cwd` is the repo root in dev, PM2,
   * and Docker; `LOYALTY_SDK_DIST` overrides for non-standard layouts.
   */
  private distDir(): string {
    return process.env.LOYALTY_SDK_DIST ?? resolve(process.cwd(), 'packages/loyalty-sdk/dist');
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
      throw new NotFoundException(`SDK bundle not found: ${name}. Build @ratio-app/loyalty-sdk.`);
    }
  }
}
