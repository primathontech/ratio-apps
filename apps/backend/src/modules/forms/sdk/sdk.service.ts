import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { safeInlineJson } from '../../../core/common/safe-inline-json';
import type { MerchantsService } from '../../../core/merchants/merchants.service';
import type { FormsDatabase } from '../db/types';
import { FORMS_MERCHANTS } from '../tokens';

/** The built widget bundle emitted by `packages/forms-sdk` (vite.config.ts). */
const WIDGET_BUNDLE = 'forms-widget.js';

/**
 * Serves the per-merchant storefront SDK entry (`/forms/sdk/:merchantId.js`)
 * — config prelude (merchant id + API base) followed by the built Lit form
 * renderer from `packages/forms-sdk/dist` (wizzy storefront precedent:
 * read from disk once, memoized).
 *
 * When the bundle has not been built yet (fresh checkout, backend-only
 * deploys) the endpoint still answers 200 with the prelude plus a
 * `console.warn` stub — an unbuilt SDK must never break merchant
 * storefronts with a hard 404 script error.
 */
@Injectable()
export class FormsSdkService {
  private readonly logger = new Logger(FormsSdkService.name);
  /** First-read cache of the widget bundle (null = looked, not built). */
  private bundleCache: string | null | undefined;

  constructor(
    @Inject(FORMS_MERCHANTS) private readonly merchants: MerchantsService<FormsDatabase>,
  ) {}

  /**
   * Renders the per-merchant SDK JS:
   *   1. Verify merchant exists and is active (uninstalled merchants serve 404)
   *   2. Emit the config prelude (merchant id + API base for schema/submit calls)
   *   3. Append the built forms-sdk widget bundle (or a warn stub when absent)
   *
   * The 5-minute `Cache-Control` header is set HERE (on the success path)
   * rather than via a route-level `@Header()` decorator: applying the
   * header at the route would cause Fastify to attach it to 404 error
   * responses too, poisoning CDNs during installation races.
   */
  async render(merchantId: string, reply: FastifyReply, origin: string): Promise<string> {
    const merchant = await this.merchants.findById(merchantId);
    if (!merchant?.isActive) {
      throw new NotFoundException({
        message: 'merchant not installed or uninstalled',
        error_code: 'MERCHANT_INACTIVE',
      });
    }
    // Only reached on success — the error path above throws, so the cache
    // header is never attached to 404 responses.
    reply.header('Cache-Control', 'public, max-age=300');
    const bundle = this.readBundle();
    if (bundle === null) {
      return `${this.buildPrelude(merchantId, origin)}\nconsole.warn('[ratio-forms] SDK bundle not built — build @ratio-app/forms-sdk to render forms.');`;
    }
    return `${this.buildPrelude(merchantId, origin)}\n${bundle}`;
  }

  private buildPrelude(merchantId: string, origin: string): string {
    const payload = {
      merchantId,
      // Public API base the SDK talks to (schema GET + submission POST live
      // under /forms/public/v1 — see TRD §2). MUST be absolute: the script
      // executes on the MERCHANT'S origin (their storefront), so a relative
      // path would resolve against their domain, not ours. Derived from the
      // origin this script was fetched from.
      apiBase: `${origin}/forms`,
    };
    return `window.__FORMS_SDK_CONFIG__ = ${safeInlineJson(payload)};`;
  }

  /**
   * Resolve + memoize the built bundle. `cwd` is the repo root under PM2 and
   * Docker but `apps/backend` under `pnpm dev`, so both candidates are
   * probed; `FORMS_SDK_DIST` overrides for non-standard layouts. Missing
   * file → null (warn stub is served).
   */
  private readBundle(): string | null {
    if (this.bundleCache !== undefined) return this.bundleCache;
    const candidates = process.env.FORMS_SDK_DIST
      ? [process.env.FORMS_SDK_DIST]
      : [
          resolve(process.cwd(), 'packages/forms-sdk/dist'),
          resolve(process.cwd(), '../../packages/forms-sdk/dist'),
        ];
    const distDir = candidates.find((dir) => existsSync(resolve(dir, WIDGET_BUNDLE)));
    if (!distDir) {
      this.logger.warn(
        `forms-sdk bundle not found in ${candidates.join(' or ')} — serving prelude + warn stub`,
      );
      this.bundleCache = null;
      return this.bundleCache;
    }
    this.bundleCache = readFileSync(resolve(distDir, WIDGET_BUNDLE), 'utf8');
    return this.bundleCache;
  }
}
