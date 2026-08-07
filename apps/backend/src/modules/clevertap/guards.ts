import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Observable } from 'rxjs';
import type { Env } from '../../config/env.schema';
import { createMerchantTokenGuard } from '../../core/common/guards/merchant-token.guard';
import type { MerchantsService } from '../../core/merchants/merchants.service';
import { createWebhookSignatureGuard } from '../../core/webhooks/webhook-signature.guard';
import type { ClevertapDatabase } from './db/types';
import { CLEVERTAP_MERCHANTS } from './tokens';

@Injectable()
export class ClevertapWebhookSignatureGuard implements CanActivate {
  private readonly inner: CanActivate;

  constructor(config: ConfigService<Env, true>) {
    const secret = config.get('RATIO_CLEVERTAP_CLIENT_SECRET' as never, {
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
export class ClevertapMerchantTokenGuard implements CanActivate {
  private readonly inner: CanActivate;

  constructor(
    @Inject(CLEVERTAP_MERCHANTS)
    merchants: MerchantsService<ClevertapDatabase>,
  ) {
    const GuardClass = createMerchantTokenGuard(merchants);
    this.inner = new GuardClass();
  }

  canActivate(ctx: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    return this.inner.canActivate(ctx);
  }
}
