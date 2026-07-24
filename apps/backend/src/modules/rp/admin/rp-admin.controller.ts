import {
  Body,
  Controller,
  Post,
  Get,
  Req,
  UnauthorizedException,
  BadGatewayException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import type { Env } from '../../../config/env.schema';
import { RpMerchantsService } from '../merchants/merchants.service';
import { RpCatalogSyncService } from '../orders/catalog-sync.service';
import { RpWebhooksService } from '../webhooks/webhooks.service';

function resolveMerchantId(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    if (token) return token;
  }
  const h = req.headers['x-merchant-id'];
  const v = Array.isArray(h) ? h[0] : h;
  return typeof v === 'string' && v ? v : null;
}

@Controller('rp/api/admin')
export class RpAdminController {
  private readonly logger = new Logger(`RP:${RpAdminController.name}`);

  constructor(
    private readonly merchants: RpMerchantsService,
    private readonly config: ConfigService<Env, true>,
    private readonly catalogSync: RpCatalogSyncService,
    private readonly webhooks: RpWebhooksService,
  ) {}

  @Get('merchants/me')
  async me(@Req() req: FastifyRequest) {
    const merchantId = resolveMerchantId(req);
    if (!merchantId) throw new UnauthorizedException('merchant session required');

    const merchant = await this.merchants.findByMerchantId(merchantId);
    if (!merchant) throw new UnauthorizedException('merchant not installed');

    return {
      id: merchant.merchantId,
      domain: merchant.domain,
      active: merchant.active,
      // Set only after RP's os-install genuinely returned 2xx (see register() below)
      // — never inferred from `domain` alone, which used to get updated regardless
      // of whether the RP-side call that followed then succeeded or failed.
      registered: Boolean(merchant.rpRegistered),
    };
  }

  /**
   * Merchant self-service pause/resume — not the platform-wide ops kill switch
   * (RP_PLATFORM_KILL_SWITCH_ENABLED). Turning this off blocks every /rp/shopify/* call for
   * THIS merchant only (RpRequestGuard's findByDomain filters on `active`) and mirrors
   * the same state into RP's own StoreDetail.active, so a merchant who tries to log
   * into the RP dashboard directly is blocked exactly as after a real Shopify uninstall
   * — see RpWebhooksService.setMerchantActiveStatus. Uses resolveMerchantId's raw
   * findByMerchantId (no active filter), so a merchant can always come back to this
   * endpoint to resume even while paused.
   */
  @Post('status')
  async setStatus(@Req() req: FastifyRequest, @Body() body: { active?: boolean }) {
    const merchantId = resolveMerchantId(req);
    if (!merchantId) throw new UnauthorizedException('merchant session required');

    const merchant = await this.merchants.findByMerchantId(merchantId);
    if (!merchant) throw new UnauthorizedException('merchant not installed');

    const active = Boolean(body?.active);
    await this.webhooks.setMerchantActiveStatus(merchantId, merchant.domain, active);
    return { active };
  }

  @Post('register')
  async register(@Req() req: FastifyRequest) {
    const merchantId = resolveMerchantId(req);
    if (!merchantId) throw new UnauthorizedException('merchant session required');

    const merchant = await this.merchants.findByMerchantId(merchantId);
    if (!merchant) throw new UnauthorizedException('merchant not installed');

    const baseUrl = this.config.get('RP_BASE_URL', { infer: true }) as string | undefined;
    const token = this.config.get('OS_RP_TOKEN', { infer: true }) as string | undefined;

    if (!baseUrl || !token) {
      this.logger.error(
        { merchantId, side: 'rp-adapter', reason: 'misconfigured', hasBaseUrl: !!baseUrl, hasToken: !!token },
        'os-install: RP_BASE_URL/OS_RP_TOKEN not configured',
      );
      throw new BadGatewayException({
        message: 'RP integration not configured',
        error_code: 'RP_NOT_CONFIGURED',
        side: 'rp-adapter',
        reason: 'misconfigured',
      });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;

    // Compute the intended store domain WITHOUT persisting it yet. (GoKwik OAuth
    // only returns merchant_id, not the store URL, so the auth callback stores
    // merchantId as domain — the registration form corrects it.) Persisting this
    // before RP confirms used to be the exact bug: a failed os-install still left
    // `domain` updated, and the old `registered` check (`domain !== merchantId`)
    // then showed "configured" on the next page load despite RP never confirming
    // anything. Both `domain` and `rpRegistered` are now written together, only
    // after a genuine 2xx from RP — see the success branch below.
    const storeDomain = (body.store_domain as string | undefined)?.trim() || merchant.domain;

    const adminEmail =
      (body.admin_email as string | undefined) ??
      (this.config.get('RP_OS_ADMIN_EMAIL' as never, { infer: true }) as string | undefined) ??
      `admin@${storeDomain}`;
    const adminPassword =
      (body.admin_password as string | undefined) ??
      (this.config.get('RP_OS_ADMIN_PASSWORD' as never, { infer: true }) as string | undefined) ??
      token;
    const adminName =
      (body.admin_name as string | undefined) ??
      (this.config.get('RP_OS_ADMIN_NAME' as never, { infer: true }) as string | undefined) ??
      'Admin';

    let res: Response;
    try {
      const payload = JSON.stringify({
        merchant_id: storeDomain,
        gokwik_merchant_id: merchantId,
        access_token: token,
        admin_email: adminEmail,
        admin_password: adminPassword,
        admin_name: adminName,
        platform: 'os',
      });

      res = await fetch(`${baseUrl}/shopify-webhook/v1/os-install`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OS-Internal-Token': token,
          'X-OS-Store': storeDomain,
        },
        body: payload,
      });
    } catch (err) {
      // We never reached RP at all (DNS failure, connection refused, timeout) —
      // distinct from RP reaching us and rejecting the request. Nothing persisted.
      this.logger.error(
        { merchantId, domain: storeDomain, side: 'rp-adapter', reason: 'network_error', err },
        'os-install: could not reach RP',
      );
      throw new BadGatewayException({
        message: 'Could not reach Return Prime — check RP_BASE_URL / network connectivity.',
        error_code: 'RP_UNREACHABLE',
        side: 'rp-adapter',
        reason: 'network_error',
      });
    }

    let installBody: Record<string, unknown>;
    try {
      installBody = (await res.json()) as Record<string, unknown>;
    } catch (err) {
      this.logger.error(
        { merchantId, domain: storeDomain, side: 'rp-adapter', reason: 'invalid_response', status: res.status, err },
        'os-install: RP response was not valid JSON',
      );
      throw new BadGatewayException({
        message: 'Return Prime returned an unreadable response.',
        error_code: 'RP_INVALID_RESPONSE',
        side: 'rp-adapter',
        reason: 'invalid_response',
      });
    }

    if (!res.ok) {
      // RP was reached and explicitly rejected the request — surface exactly what
      // it said, not a blanket message every time.
      const rpMessage = (installBody.message as string | undefined) ?? (installBody.messageCode as string | undefined);
      this.logger.error(
        { merchantId, domain: storeDomain, side: 'return-prime', reason: 'rejected', status: res.status, installBody },
        'os-install: RP rejected registration',
      );
      throw new BadGatewayException({
        message: rpMessage ? `Return Prime rejected registration: ${rpMessage}` : 'Return Prime rejected registration.',
        error_code: 'RP_REJECTED',
        side: 'return-prime',
        reason: 'rejected',
        rp: installBody,
      });
    }

    // Only now — a genuine confirmed 2xx from RP — persist domain + registered.
    if (storeDomain !== merchant.domain) {
      await this.merchants.updateDomain(merchantId, storeDomain);
    }
    await this.merchants.setRpRegistered(merchantId, true);
    this.logger.log({ merchantId, domain: storeDomain }, 'os-install: RP confirmed registration');

    // Registration succeeded — kick off the OS→RP catalog import so RP has products
    // for the exchange picker. Fire-and-forget: never block/fail the register response.
    this.catalogSync
      .syncCatalog(merchantId)
      .catch((err) =>
        this.logger.error({ merchantId, side: 'rp-adapter', reason: 'catalog_sync_failed', err }, 'catalog sync trigger failed'),
      );

    return { registered: true, domain: storeDomain, status: installBody.status ?? installBody.message };
  }
}
