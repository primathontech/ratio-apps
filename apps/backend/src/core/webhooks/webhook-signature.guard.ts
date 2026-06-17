import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

const SIGNATURE_HEADER = 'x-openstore-signature';

/**
 * Returns a per-module guard CLASS pre-bound to that module's webhook secret.
 * Each module's NestJS module registers the produced class as a provider and
 * decorates its webhook controller with `@UseGuards(MyWebhookSignatureGuard)`.
 */
export function createWebhookSignatureGuard(secret: string): new () => CanActivate {
  @Injectable()
  class WebhookSignatureGuard implements CanActivate {
    canActivate(ctx: ExecutionContext): boolean {
      const req = ctx.switchToHttp().getRequest<FastifyRequest & { rawBody?: Buffer | string }>();
      const raw = req.rawBody;
      if (!raw) {
        throw new UnauthorizedException({
          message: 'webhook missing raw body',
          error_code: 'WEBHOOK_NO_RAW_BODY',
        });
      }
      const header = req.headers[SIGNATURE_HEADER];
      if (typeof header !== 'string' || !header.startsWith('sha256=')) {
        throw new UnauthorizedException({
          message: 'invalid signature header',
          error_code: 'WEBHOOK_BAD_SIGNATURE',
        });
      }
      const expected = createHmac('sha256', secret).update(raw).digest('hex');
      const provided = header.slice('sha256='.length);
      // Cheap pre-check: HMAC-SHA256 hex is always 64 chars. Mismatched
      // string lengths can't possibly match — bail early so the constant-
      // time compare always operates on equal-length buffers.
      if (expected.length !== provided.length) {
        throw new UnauthorizedException({ error_code: 'WEBHOOK_BAD_SIGNATURE' });
      }
      const bufExpected = Buffer.from(expected, 'hex');
      const bufProvided = Buffer.from(provided, 'hex');
      // `Buffer.from(str, 'hex')` SILENTLY truncates on the first non-hex
      // character — so a 64-char header with garbage in it would yield a
      // short buffer, and `timingSafeEqual` would throw RangeError → 500.
      // Reject anything that doesn't decode to a non-empty buffer of the
      // expected (32-byte) length.
      if (bufProvided.length === 0 || bufExpected.length !== bufProvided.length) {
        throw new UnauthorizedException({ error_code: 'WEBHOOK_BAD_SIGNATURE' });
      }
      const ok = timingSafeEqual(bufExpected, bufProvided);
      if (!ok) {
        throw new UnauthorizedException({ error_code: 'WEBHOOK_BAD_SIGNATURE' });
      }
      return true;
    }
  }
  return WebhookSignatureGuard;
}
