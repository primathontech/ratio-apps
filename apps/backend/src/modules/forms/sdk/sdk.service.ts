import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { safeInlineJson } from '../../../core/common/safe-inline-json';
import type { MerchantsService } from '../../../core/merchants/merchants.service';
import type { FormsDatabase } from '../db/types';
import { FORMS_MERCHANTS } from '../tokens';

/**
 * Serves the per-merchant storefront SDK entry (`/forms/sdk/:merchantId.js`).
 *
 * Part 1 (data + schema layer) ships the config prelude only: merchant
 * validation + a `window.__FORMS_SDK_CONFIG__` bootstrap. The Lit form
 * renderer bundle is built by `packages/forms-sdk` and appended by the
 * storefront phase (part 2, mirroring `modules/wizzy/storefront/`).
 */
@Injectable()
export class FormsSdkService {
  constructor(
    @Inject(FORMS_MERCHANTS) private readonly merchants: MerchantsService<FormsDatabase>,
  ) {}

  /**
   * Renders the per-merchant SDK JS:
   *   1. Verify merchant exists and is active (uninstalled merchants serve 404)
   *   2. Emit the config prelude (merchant id + API base for schema/submit calls)
   *
   * The 5-minute `Cache-Control` header is set HERE (on the success path)
   * rather than via a route-level `@Header()` decorator: applying the
   * header at the route would cause Fastify to attach it to 404 error
   * responses too, poisoning CDNs during installation races.
   */
  async render(merchantId: string, reply: FastifyReply): Promise<string> {
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
    return `${this.buildPrelude(merchantId)}\n// Form Builder storefront bundle: built by packages/forms-sdk and appended here by the storefront phase.`;
  }

  private buildPrelude(merchantId: string): string {
    const payload = {
      merchantId,
      // Public API base the SDK talks to (schema GET + submission POST live
      // under /forms/public/v1 — see TRD §2); same-origin as this script.
      apiBase: '/forms',
    };
    return `window.__FORMS_SDK_CONFIG__ = ${safeInlineJson(payload)};`;
  }
}
