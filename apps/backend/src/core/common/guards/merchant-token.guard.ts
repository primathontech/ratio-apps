import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { FastifyRequest } from 'fastify';
import type { DatabaseWithMerchants } from '../../merchants/merchant.types';
import type { MerchantsService } from '../../merchants/merchants.service';

/**
 * Merchant-id session guard. Per-module factory: each module's NestJS module
 * calls `createMerchantTokenGuard(merchantsInstance)` to produce a guard class
 * bound to its own MerchantsService.
 *
 * Accepted credential transports (one of):
 *   1. `Authorization: Bearer <merchantId>`
 *   2. `X-Merchant-Id: <merchantId>`
 *
 * NO query-string fallback (Finding #13): merchant ids appear in access logs,
 * referer headers, and browser history.
 *
 * The guard does not block inactive merchants — it attaches them with
 * `isActive: false` so the admin can route to `/disabled` instead of dropping
 * the session.
 */
export function createMerchantTokenGuard<DB extends DatabaseWithMerchants>(
  merchants: MerchantsService<DB>,
): new () => CanActivate {
  @Injectable()
  class MerchantTokenGuard implements CanActivate {
    async canActivate(ctx: ExecutionContext): Promise<boolean> {
      const req = ctx.switchToHttp().getRequest<FastifyRequest & { merchant?: Merchant }>();

      const merchantId = resolveMerchantId(req);
      if (!merchantId) {
        throw new UnauthorizedException({
          message: 'merchant session required',
          error_code: 'MISSING_MERCHANT_SESSION',
        });
      }

      const row = await merchants.findById(merchantId);
      if (!row) {
        throw new UnauthorizedException({
          message: 'merchant not installed',
          error_code: 'MERCHANT_NOT_FOUND',
        });
      }
      req.merchant = {
        id: row.id,
        // MySQL stores `is_active` as TINYINT(1) and mysql2 returns 0/1, not
        // a JS boolean. Normalize to boolean here so consumers (admin SPAs,
        // route guards) get the type they expect.
        isActive: Boolean(row.isActive),
        installedAt: row.installedAt,
        uninstalledAt: row.uninstalledAt,
      };
      return true;
    }
  }
  return MerchantTokenGuard;
}

function resolveMerchantId(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    if (token) return token;
  }
  const headerId = req.headers['x-merchant-id'];
  const headerVal = Array.isArray(headerId) ? headerId[0] : headerId;
  if (typeof headerVal === 'string' && headerVal) return headerVal;
  // Intentional: NO query-string fallback (Finding #13).
  return null;
}
