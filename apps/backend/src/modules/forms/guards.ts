import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Observable } from 'rxjs';
import type { Env } from '../../config/env.schema';
import { createMerchantTokenGuard } from '../../core/common/guards/merchant-token.guard';
import type { MerchantsService } from '../../core/merchants/merchants.service';
import { createWebhookSignatureGuard } from '../../core/webhooks/webhook-signature.guard';
import type { FormsDatabase } from './db/types';
import { FORMS_MERCHANTS } from './tokens';

// @UseGuards accepts only classes, so wrap the factory output in an @Injectable, built eagerly so `this.inner` is non-null before any concurrent first request.

@Injectable()
export class FormsWebhookSignatureGuard implements CanActivate {
  private readonly inner: CanActivate;

  constructor(config: ConfigService<Env, true>) {
    const secret = config.get('RATIO_FORMS_CLIENT_SECRET' as never, {
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
export class FormsMerchantTokenGuard implements CanActivate {
  private readonly inner: CanActivate;

  constructor(
    @Inject(FORMS_MERCHANTS)
    merchants: MerchantsService<FormsDatabase>,
  ) {
    const GuardClass = createMerchantTokenGuard(merchants);
    this.inner = new GuardClass();
  }

  canActivate(ctx: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    return this.inner.canActivate(ctx);
  }
}
