import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import type { Env } from '../../config/env.schema';
import { createWebhookSignatureGuard } from '../../core/webhooks/webhook-signature.guard';
import { RpMerchantsService } from './merchants/merchants.service';
import type { RpMerchantRow } from './db/types';

export interface RpRequest extends FastifyRequest {
  rpMerchant: RpMerchantRow;
}

/**
 * Per-module guard classes.
 *
 * NestJS's `@UseGuards(...)` only accepts a class reference, so we wrap
 * factory-produced guards in an `@Injectable()` class that builds the
 * underlying guard once in the constructor — matching the Meta module pattern.
 */

@Injectable()
export class RpWebhookSignatureGuard implements CanActivate {
  private readonly inner: CanActivate;

  constructor(config: ConfigService<Env, true>) {
    const secret = config.get('RATIO_RP_CLIENT_SECRET' as never, { infer: true }) as string;
    const GuardClass = createWebhookSignatureGuard(secret);
    this.inner = new GuardClass();
  }

  canActivate(ctx: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    return this.inner.canActivate(ctx);
  }
}

/**
 * Validates inbound RP requests.
 *
 * Two-layer check:
 *   1. X-Shopify-Access-Token == RP_INTERNAL_API_TOKEN  (proves caller is RP)
 *   2. X-Store == merchant domain  (identifies which merchant)
 *
 * Attaches `rpMerchant` to the request for downstream use.
 */
@Injectable()
export class RpRequestGuard implements CanActivate {
  private readonly logger = new Logger(RpRequestGuard.name);

  constructor(
    private readonly merchants: RpMerchantsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RpRequest>();
    const token = req.headers['x-shopify-access-token'] as string | undefined;
    const expected = this.config.get('RP_INTERNAL_API_TOKEN', { infer: true });

    if (!token || token !== expected) {
      throw new UnauthorizedException('invalid token');
    }

    const rawDomain = req.headers['x-store'] as string | undefined;
    if (!rawDomain) {
      throw new BadRequestException('X-Store header required');
    }
    // Try exact match first; fall back to domain without .myshopify.com suffix
    const domain = rawDomain;

    const merchant = await this.merchants.findByDomain(domain) ??
      await this.merchants.findByDomain(domain.replace(/\.myshopify\.com$/i, ''));
    if (!merchant) {
      throw new UnauthorizedException('merchant not installed');
    }

    req.rpMerchant = merchant;
    return true;
  }
}
