import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared';
import type { FastifyRequest } from 'fastify';

/**
 * Pulls the merchant attached by the per-module merchant-token guard (e.g.
 * `TemplateMerchantTokenGuard`, `TemplateMerchantTokenGuard`). Throws if
 * used without one of those guards — guards always run before param
 * decorators, so a missing `req.merchant` here means the route forgot to
 * declare its module's guard.
 */
export const CurrentMerchant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Merchant => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { merchant?: Merchant }>();
    if (!req.merchant) {
      throw new Error(
        '@CurrentMerchant() used without the per-module merchant-token guard — ' +
          'declare @UseGuards(<App>MerchantTokenGuard) on this route (see AGENTS.md)',
      );
    }
    return req.merchant;
  },
);
