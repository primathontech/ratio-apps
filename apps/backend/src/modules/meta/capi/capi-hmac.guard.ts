import { createHmac, timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

@Injectable()
export class CapiHmacGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const secret = process.env.RATIO_META_CAPI_HMAC_SECRET;
    if (!secret) return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest & { body: Record<string, unknown> }>();
    const body = req.body as Record<string, unknown> | undefined;
    const ts = body?._ts;
    const sig = body?._sig;

    if (typeof ts !== 'number' || typeof sig !== 'string') {
      throw new UnauthorizedException({ message: 'missing _ts/_sig', error_code: 'CAPI_BAD_SIGNATURE' });
    }

    const now = Math.floor(Date.now() / 300000);
    if (ts !== now && ts !== now - 1) {
      throw new UnauthorizedException({ message: 'expired timestamp', error_code: 'CAPI_BAD_SIGNATURE' });
    }

    const expected = createHmac('sha256', secret).update(String(ts)).digest();
    const actual = Buffer.from(sig, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException({ message: 'invalid signature', error_code: 'CAPI_BAD_SIGNATURE' });
    }

    return true;
  }
}
