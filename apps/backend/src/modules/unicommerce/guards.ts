import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Observable } from 'rxjs';
import type { FastifyRequest } from 'fastify';
import type { Env } from '../../config/env.schema';
import { redactSensitive } from '../../core/common/redact';
import { createMerchantTokenGuard } from '../../core/common/guards/merchant-token.guard';
import type { MerchantsService } from '../../core/merchants/merchants.service';
import { createWebhookSignatureGuard } from '../../core/webhooks/webhook-signature.guard';
import { UcAuthService } from './services/uc-auth.service';
import { UcCredentialsService } from './services/credentials.service';
import type { UnicommerceDatabase } from './db/types';
import { UC_MERCHANTS } from './tokens';

// DEBUG only (opt-in via LOG_LEVEL=debug) — the full inbound request exactly
// as Unicommerce sent it: method, url, every header, and body, with
// credential-shaped fields (apikey, securitykey, authorization, cookie)
// redacted via redactSensitive. Shared by every UC-facing guard/controller
// entry point so a real inbound call can be replayed/inspected without
// re-deriving it from partial log lines.
const inboundLog = new Logger('UnicommerceInboundRequest');
// `req.url` can itself carry a credential in the query string (e.g.
// GET /authToken?username=...&password=...) — redactSensitive only walks
// object structures (headers/body), so the URL needs its own pass.
function redactUrl(url: string | undefined): string | undefined {
  return url?.replace(/([?&](?:password|apikey|securitykey|token)=)[^&]*/gi, '$1***redacted***');
}
export function logInboundRequest(req: FastifyRequest): void {
  inboundLog.debug({
    msg: 'unicommerce inbound request',
    method: req.method,
    url: redactUrl(req.url),
    headers: redactSensitive(req.headers),
    body: redactSensitive(req.body),
  });
}

/**
 * Validates Ratio's own webhook HMAC signature on inbound webhook deliveries
 * (orders/create, orders/cancelled, products/create, products/update) — a
 * DIFFERENT guard from `UcApiKeyGuard` below, which validates Unicommerce's
 * own `apiKey` on the MP-contract endpoints. This one wraps the shared
 * factory the same way `TemplateWebhookSignatureGuard`/`GoogleWebhook...`
 * do, pre-bound to this module's own client secret.
 */
@Injectable()
export class UcWebhookSignatureGuard implements CanActivate {
  private readonly inner: CanActivate;

  constructor(config: ConfigService<Env, true>) {
    const secret = config.get('RATIO_UNICOMMERCE_CLIENT_SECRET' as never, { infer: true }) as string;
    const GuardClass = createWebhookSignatureGuard(secret);
    this.inner = new GuardClass();
  }

  canActivate(ctx: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    return this.inner.canActivate(ctx);
  }
}

/**
 * Validates the `apiKey` header Unicommerce sends on every inbound call
 * except /authToken itself. Attaches the resolved merchantId to the request
 * so downstream controllers don't re-look it up. This is DELIBERATELY
 * separate from the standard Ratio-OAuth merchant-token guard used by
 * other modules — Unicommerce authenticates via a completely different
 * credential system (see uc-auth.service.ts).
 *
 * Also enforces the kill-switch (paused/uninstalled merchants get 403) and
 * stamps the last_inbound_call_at timestamp on uc_credentials — every
 * authenticated inbound call updates it, so the alerting service can detect
 * silence.
 */
@Injectable()
export class UcApiKeyGuard implements CanActivate {
  constructor(
    private readonly auth: UcAuthService,
    private readonly credentials: UcCredentialsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { ucMerchantId?: string }>();
    logInboundRequest(req);
    const apiKey = req.headers['apikey'] as string | undefined;
    if (!apiKey) throw new UnauthorizedException('missing apiKey header');

    const merchantId = await this.auth.validateToken(apiKey);
    if (!merchantId) throw new UnauthorizedException('invalid or expired apiKey');

    const status = await this.credentials.getStatus(merchantId);
    if (status === 'paused') {
      throw new ForbiddenException('merchant is paused — inbound calls blocked');
    }
    if (status === 'uninstalled') {
      throw new ForbiddenException('merchant is uninstalled — inbound calls blocked');
    }

    req.ucMerchantId = merchantId;

    await this.credentials.touchInboundCall(merchantId).catch(() => {});
    return true;
  }
}

/**
 * Kill-switch guard — blocks inbound calls when the merchant's credentials
 * are in `paused` or `uninstalled` status. Must be used AFTER UcApiKeyGuard
 * (which resolves ucMerchantId on the request). Returns a 403 with a clear
 * message rather than a generic 401/500.
 */
@Injectable()
export class UcKillSwitchGuard implements CanActivate {
  constructor(private readonly credentials: UcCredentialsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { ucMerchantId?: string }>();
    const merchantId = req.ucMerchantId;
    if (!merchantId) return true;

    const status = await this.credentials.getStatus(merchantId);
    if (status === 'paused') {
      throw new ForbiddenException('merchant is paused — inbound calls blocked');
    }
    if (status === 'uninstalled') {
      throw new ForbiddenException('merchant is uninstalled — inbound calls blocked');
    }
    return true;
  }
}

/**
 * Standard Ratio-OAuth merchant-token guard (Bearer/X-Merchant-Id, see
 * createMerchantTokenGuard's own doc) — used ONLY by UcMerchantsController's
 * `GET /unicommerce/api/merchants/me`, the admin SPA's own session
 * bootstrap. DELIBERATELY separate from UcApiKeyGuard above: that one
 * authenticates Unicommerce itself calling our MP-contract endpoints; this
 * one authenticates the merchant's own browser session calling our admin
 * API, exactly the same distinction every sibling module makes between its
 * `<Slug>MerchantTokenGuard` and any vendor-specific inbound guard.
 */
@Injectable()
export class UcMerchantTokenGuard implements CanActivate {
  private readonly inner: CanActivate;

  constructor(@Inject(UC_MERCHANTS) merchants: MerchantsService<UnicommerceDatabase>) {
    const GuardClass = createMerchantTokenGuard(merchants);
    this.inner = new GuardClass();
  }

  canActivate(ctx: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    return this.inner.canActivate(ctx);
  }
}
