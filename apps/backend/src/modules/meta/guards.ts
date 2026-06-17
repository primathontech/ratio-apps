import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Observable } from 'rxjs';
import type { Env } from '../../config/env.schema';
import { createMerchantTokenGuard } from '../../core/common/guards/merchant-token.guard';
import type { MerchantsService } from '../../core/merchants/merchants.service';
import { createWebhookSignatureGuard } from '../../core/webhooks/webhook-signature.guard';
import type { MetaDatabase } from './db/types';
import { META_MERCHANTS } from './tokens';

/**
 * Per-module guard CLASSES.
 *
 * NestJS's `@UseGuards(...)` decorator only accepts a class reference (or an
 * instance) — it does NOT resolve DI symbols. So even though every guard is
 * conceptually produced by a factory (`createWebhookSignatureGuard` /
 * `createMerchantTokenGuard`), we wrap the factory output in an
 * `@Injectable()` class that builds the underlying guard once in the
 * constructor using NestJS-resolved dependencies.
 *
 * Constructing eagerly in the constructor (rather than lazily in
 * `onModuleInit` or on first request) means `this.inner` is non-null the
 * instant Nest instantiates the guard — no race between concurrent first
 * requests, and no risk of an opaque "Cannot read properties of undefined"
 * if `canActivate` is invoked before the lifecycle hook fires (e.g. via
 * direct instantiation in tests).
 */

@Injectable()
export class MetaWebhookSignatureGuard implements CanActivate {
  private readonly inner: CanActivate;

  constructor(config: ConfigService<Env, true>) {
    const secret = config.get('RATIO_META_CLIENT_SECRET' as never, {
      infer: true,
    }) as string;
    const GuardClass = createWebhookSignatureGuard(secret);
    this.inner = new GuardClass();
  }

  canActivate(ctx: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    return this.inner.canActivate(ctx);
  }
}

@Injectable()
export class MetaMerchantTokenGuard implements CanActivate {
  private readonly inner: CanActivate;

  constructor(
    @Inject(META_MERCHANTS)
    merchants: MerchantsService<MetaDatabase>,
  ) {
    const GuardClass = createMerchantTokenGuard(merchants);
    this.inner = new GuardClass();
  }

  canActivate(ctx: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    return this.inner.canActivate(ctx);
  }
}
