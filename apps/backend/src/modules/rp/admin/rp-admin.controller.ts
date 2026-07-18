import {
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
      // True once the merchant has completed the registration form and the
      // domain has been updated from the GoKwik merchant-id fallback.
      registered: merchant.domain !== merchant.merchantId,
    };
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
      throw new BadGatewayException('RP integration not configured');
    }

    const body = (req.body ?? {}) as Record<string, unknown>;

    // If merchant provided their actual store domain, update it in the DB.
    // (GoKwik OAuth only returns merchant_id, not the store URL, so the auth
    // callback stores merchantId as domain — the registration form corrects it.)
    const storeDomain = (body.store_domain as string | undefined)?.trim() || merchant.domain;
    if (storeDomain !== merchant.domain) {
      await this.merchants.updateDomain(merchantId, storeDomain);
    }

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

      const res = await fetch(`${baseUrl}/shopify-webhook/v1/os-install`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OS-Internal-Token': token,
          'X-OS-Store': storeDomain,
        },
        body: payload,
      });

      const installBody = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        this.logger.error({ domain: storeDomain, status: res.status, installBody }, 'os-install failed');
        throw new BadGatewayException('RP registration failed');
      }

      // Registration succeeded — kick off the OS→RP catalog import so RP has products
      // for the exchange picker. Fire-and-forget: never block/fail the register response.
      this.catalogSync
        .syncCatalog(merchantId)
        .catch((err) => this.logger.error({ merchantId, err }, 'catalog sync trigger failed'));

      return { registered: true, domain: storeDomain, status: installBody.status ?? installBody.message };
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      this.logger.error({ domain: storeDomain, err }, 'os-install threw');
      throw new BadGatewayException('RP registration failed');
    }
  }
}
