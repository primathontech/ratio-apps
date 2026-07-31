import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
  ServiceUnavailableException,
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
 *   1. X-Shopify-Access-Token == OS_RP_TOKEN  (proves caller is RP)
 *   2. X-Store == merchant domain  (identifies which merchant)
 *
 * Attaches `rpMerchant` to the request for downstream use.
 */
@Injectable()
export class RpRequestGuard implements CanActivate {
  private readonly logger = new Logger(`RP:${RpRequestGuard.name}`);

  constructor(
    private readonly merchants: RpMerchantsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Platform-wide emergency kill switch (PRD §11) — checked before the token/
    // merchant lookup so a disabled deployment never touches the DB or leaks
    // whether a store is installed.
    const compatEnabled = this.config.get('RP_PLATFORM_KILL_SWITCH_ENABLED' as never, {
      infer: true,
    }) as string;
    if (compatEnabled === 'false') {
      throw new ServiceUnavailableException('Return Prime compatibility API is disabled');
    }

    const req = ctx.switchToHttp().getRequest<RpRequest>();
    const token = req.headers['x-shopify-access-token'] as string | undefined;
    const expected = this.config.get('OS_RP_TOKEN', { infer: true });

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
