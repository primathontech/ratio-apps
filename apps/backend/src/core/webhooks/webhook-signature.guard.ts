import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

// Ratio signs webhooks with HMAC-SHA256(rawBody, app client_secret), delivered
// in this header (Fastify lowercases header names). The digest encoding may be
// hex or base64 depending on platform version, so we accept either — both
// compared in constant time after a length check.
const SIGNATURE_HEADER = 'x-ratio-hmac-sha256';
const log = new Logger('WebhookSignatureGuard');

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Returns a per-module guard CLASS pre-bound to that module's webhook secret.
 *
 * Signature policy:
 *  - A signature header that IS present is ALWAYS verified (every environment).
 *  - When the header is ABSENT: the request is skipped (warning logged) when
 *    EITHER `NODE_ENV !== 'production'` OR `WEBHOOK_SIGNATURE_OPTIONAL=true`.
 *    The second flag exists for sandbox/dev Docker images that run NODE_ENV=production
 *    but still receive unsigned webhooks. Production deployments that do NOT set
 *    this flag continue to enforce the signature on every request.
 *  - Set `WEBHOOK_SIGNATURE_OPTIONAL=true` only on sandbox/dev containers; never
 *    on a real production deployment.
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
      const headerRaw = req.headers[SIGNATURE_HEADER];
      const header = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;

      if (typeof header !== 'string' || !header) {
        const skip =
          process.env.NODE_ENV !== 'production' ||
          process.env.WEBHOOK_SIGNATURE_OPTIONAL === 'true';
        if (skip) {
          log.warn({
            msg: 'webhook signature header absent — skipped',
            url: req.url,
            reason: process.env.NODE_ENV !== 'production' ? 'non-production' : 'WEBHOOK_SIGNATURE_OPTIONAL',
          });
          return true;
        }
        throw new UnauthorizedException({
          message: 'invalid signature header',
          error_code: 'WEBHOOK_BAD_SIGNATURE',
        });
      }

      // Tolerate a legacy "sha256=" prefix if a sender includes one.
      const provided = header.startsWith('sha256=') ? header.slice('sha256='.length) : header;
      const digest = createHmac('sha256', secret).update(raw).digest();
      const ok =
        safeEqual(provided, digest.toString('hex')) || safeEqual(provided, digest.toString('base64'));
      if (!ok) {
        throw new UnauthorizedException({ error_code: 'WEBHOOK_BAD_SIGNATURE' });
      }
      return true;
    }
  }
  return WebhookSignatureGuard;
}
