import { createHmac, timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

const SIGNATURE_HEADER = 'x-ratio-signature';

/**
 * Verifies the Ratio product-webhook signature: HMAC-SHA256 of the RAW request
 * body keyed by `RATIO_META_WEBHOOK_SECRET`, compared (constant-time) to the
 * `X-Ratio-Signature` header.
 *
 * If the secret is NOT configured, verification is skipped with a warning so
 * local testing works without a real signature — production MUST set the secret.
 */
@Injectable()
export class RatioWebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(RatioWebhookSignatureGuard.name);

  canActivate(ctx: ExecutionContext): boolean {
    const secret = process.env.RATIO_META_WEBHOOK_SECRET;
    if (!secret) {
      this.logger.warn('RATIO_META_WEBHOOK_SECRET unset — webhook signature NOT verified (dev only)');
      return true;
    }

    const req = ctx.switchToHttp().getRequest<FastifyRequest & { rawBody?: Buffer | string }>();
    const raw = req.rawBody;
    if (!raw) throw new UnauthorizedException({ message: 'webhook missing raw body', error_code: 'WEBHOOK_NO_RAW_BODY' });

    const header = req.headers[SIGNATURE_HEADER];
    if (typeof header !== 'string') {
      throw new UnauthorizedException({ message: 'missing signature', error_code: 'WEBHOOK_BAD_SIGNATURE' });
    }

    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    // strip an optional "sha256=" prefix some providers add
    const provided = header.startsWith('sha256=') ? header.slice(7) : header;
    if (expected.length !== provided.length) {
      throw new UnauthorizedException({ error_code: 'WEBHOOK_BAD_SIGNATURE' });
    }
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
      throw new UnauthorizedException({ error_code: 'WEBHOOK_BAD_SIGNATURE' });
    }
    return true;
  }
}
