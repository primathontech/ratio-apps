import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Observable } from 'rxjs';
import type { Env } from '../../config/env.schema';
import { createWebhookSignatureGuard } from '../../core/webhooks/webhook-signature.guard';

@Injectable()
export class UcWebhookSignatureGuard implements CanActivate {
  private readonly inner: CanActivate;

  constructor(config: ConfigService<Env, true>) {
    const secret = config.get('RATIO_UNICOMMERCE_CLIENT_SECRET' as never, {
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
export class UcAdminTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const token = req.headers['x-uc-admin-token'];
    if (token === 'uc-admin-dev-token') return true;
    throw new UnauthorizedException({ error_code: 'UC_ADMIN_UNAUTHORIZED' });
  }
}
