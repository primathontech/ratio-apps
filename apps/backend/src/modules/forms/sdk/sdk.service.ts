import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { resolveSdkDistPath } from '../../../core/common/resolve-sdk-dist-path';
import { safeInlineJson } from '../../../core/common/safe-inline-json';
import type { MerchantsService } from '../../../core/merchants/merchants.service';
import type { FormsDatabase } from '../db/types';
import { FORMS_MERCHANTS } from '../tokens';

/** The built widget bundle emitted by `packages/forms-sdk` (vite.config.ts). */
const WIDGET_BUNDLE = 'forms-widget.js';

/** Serves the per-merchant storefront SDK (`/forms/sdk/:merchantId.js`): config prelude + memoized bundle; an unbuilt bundle still answers 200 with a warn stub so it never breaks storefronts with a 404 script error. */
@Injectable()
export class FormsSdkService {
  private readonly logger = new Logger(FormsSdkService.name);
  /** First-read cache of the widget bundle (null = looked, not built). */
  private bundleCache: string | null | undefined;

  constructor(
    @Inject(FORMS_MERCHANTS) private readonly merchants: MerchantsService<FormsDatabase>,
  ) {}

  /** Renders per-merchant SDK JS (404 for inactive merchants); Cache-Control set on the success path only — a route `@Header()` would cache 404s and poison CDNs during install races. */
  async render(merchantId: string, reply: FastifyReply, origin: string): Promise<string> {
    const merchant = await this.merchants.findById(merchantId);
    if (!merchant?.isActive) {
      throw new NotFoundException({
        message: 'merchant not installed or uninstalled',
        error_code: 'MERCHANT_INACTIVE',
      });
    }
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
      // MUST be absolute (TRD §2): the script runs on the merchant's origin, so a relative path would resolve against their domain, not ours.
      apiBase: `${origin}/forms`,
    };
    return `window.__FORMS_SDK_CONFIG__ = ${safeInlineJson(payload)};`;
  }

  /** Resolve + memoize the built bundle via {@link resolveSdkDistPath}; a missing bundle file → null (warn stub served). */
  private readBundle(): string | null {
    if (this.bundleCache !== undefined) return this.bundleCache;
    const distDir = resolveSdkDistPath('forms', __dirname);
    const bundlePath = resolve(distDir, WIDGET_BUNDLE);
    if (!existsSync(bundlePath)) {
      this.logger.warn(
        `forms-sdk bundle not found in ${distDir} — serving prelude + warn stub`,
      );
      this.bundleCache = null;
      return this.bundleCache;
    }
    this.bundleCache = readFileSync(bundlePath, 'utf8');
    return this.bundleCache;
  }
}
