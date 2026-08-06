import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Req,
  UnauthorizedException,
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

    const registered = Boolean(merchant.rpRegistered);
    // Only ask RP when we don't already know locally — skips the extra
    // round-trip on every page load once a merchant is confirmed registered.
    // Null (not 'signup') means "inconclusive" (RP unreachable/misconfigured) —
    // the SPA falls back to asking the merchant, same as before this existed.
    let suggestedMode: 'login' | 'signup' | null = null;
    if (!registered) {
      const check = await this.checkExistsInRp(merchantId, merchant.domain);
      if (check) suggestedMode = check.exists ? 'login' : 'signup';
    }

    return {
      id: merchant.merchantId,
      domain: merchant.domain,
      active: merchant.active,
      // Set only after RP's os-install genuinely returned 2xx (see register() below)
      // — never inferred from `domain` alone, which used to get updated regardless
      // of whether the RP-side call that followed then succeeded or failed.
      registered,
      suggestedMode,
    };
  }

  /**
   * Read-only probe against RP's `mode: 'check'` os-install branch — lets the SPA
   * skip the manual "have you used Return Prime before?" guess for a merchant we
   * haven't registered locally yet. Returns null (not false) when RP is
   * unreachable/misconfigured or the check itself fails, so callers can tell
   * "confirmed doesn't exist" apart from "couldn't ask" and fall back to the
   * manual choice screen in the latter case instead of guessing signup.
   */
  private async checkExistsInRp(
    merchantId: string,
    storeDomain: string,
  ): Promise<{ exists: boolean; platform: string | undefined } | null> {
    const baseUrl = this.config.get('RP_BASE_URL', { infer: true }) as string | undefined;
    const token = this.config.get('OS_RP_TOKEN', { infer: true }) as string | undefined;
    if (!baseUrl || !token) return null;

    try {
      const res = await fetch(`${baseUrl}/shopify-webhook/v1/os-install`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OS-Internal-Token': token,
          'X-OS-Store': storeDomain,
        },
        body: JSON.stringify({
          merchant_id: storeDomain,
          gokwik_merchant_id: merchantId,
          platform: 'os',
          mode: 'check',
        }),
      });
      if (!res.ok) return null;

      const body = (await res.json()) as Record<string, unknown>;
      const data = (body.data ?? {}) as Record<string, unknown>;
      return { exists: Boolean(data.exists), platform: data.platform as string | undefined };
    } catch (err) {
      this.logger.error(
        { merchantId, domain: storeDomain, side: 'rp-adapter', reason: 'check_failed', err },
        'os-install check: could not reach RP',
      );
      return null;
    }
  }

  /**
   * Merchant self-service pause/resume — not the platform-wide ops kill switch
   * (RP_PLATFORM_KILL_SWITCH_ENABLED). Turning this off blocks every /rp/shopify/* call for
   * THIS merchant only (RpRequestGuard's findByDomain filters on `active`) and mirrors
   * the same state into RP's own StoreDetail.active, so a merchant who tries to log
   * into the RP dashboard directly is blocked exactly as after a real Shopify uninstall.
   * Uses resolveMerchantId's raw findByMerchantId (no active filter), so a merchant can
   * always come back to this endpoint to resume even while paused.
   *
   * Ratio/OS doesn't yet fire a real `app/uninstalled` webhook — so, for now, turning
   * this off IS the only "uninstall" trigger available, and does the full severance a
   * real uninstall would: see RpWebhooksService.handleAppUninstalled (restores any
   * snapshotted previous_plan and nulls os_store_url on RP's side for a dual-platform
   * merchant, purges our own copy). When Ratio ships a real webhook, wire it to that
   * same handler — don't add a second, divergent disable path. Resuming stays the
   * simple relay: there's no plan/link state to restore on that side.
   */
  @Post('status')
  async setStatus(@Req() req: FastifyRequest, @Body() body: { active?: boolean }) {
    const merchantId = resolveMerchantId(req);
    if (!merchantId) throw new UnauthorizedException('merchant session required');

    const merchant = await this.merchants.findByMerchantId(merchantId);
    if (!merchant) throw new UnauthorizedException('merchant not installed');

    const active = Boolean(body?.active);
    if (active) {
      await this.webhooks.setMerchantActiveStatus(merchantId, merchant.domain, true);
    } else {
      await this.webhooks.handleAppUninstalled(merchantId);
    }
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
        {
          merchantId,
          side: 'rp-adapter',
          reason: 'misconfigured',
          hasBaseUrl: !!baseUrl,
          hasToken: !!token,
        },
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

    // Never let the merchantId placeholder itself reach RP's os-install as a real
    // domain — for a dual-platform merchant this would overwrite a correct
    // os_store_url with garbage (RP's login-mode linking logic only skips touching
    // os_store_url when the submitted domain matches an EXISTING value; a
    // placeholder differs from everything, so it looks like a genuine new domain to
    // link). Require the caller to explicitly supply the real one instead of
    // silently falling through on a merchant.domain that was never actually
    // corrected (e.g. right after a reinstall — see merchants.service.ts's upsert).
    if (storeDomain === merchantId) {
      throw new BadRequestException({
        message: 'Store domain could not be determined — please provide store_domain explicitly.',
        error_code: 'RP_DOMAIN_UNKNOWN',
        side: 'rp-adapter',
        reason: 'domain_placeholder',
      });
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

    // 'signup' (default) = "I'm new here" — rejected by RP if this merchant_id
    // already has an account. 'login' = "I already use Return Prime" — no
    // email/password needed, links to the existing account or rejects if none
    // exists. See RegisterScreen's login/signup choice in admin-rp.
    const mode = body.mode === 'login' ? 'login' : 'signup';

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
        mode,
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
        {
          merchantId,
          domain: storeDomain,
          side: 'rp-adapter',
          reason: 'invalid_response',
          status: res.status,
          err,
        },
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
      const rpMessage =
        (installBody.message as string | undefined) ??
        (installBody.messageCode as string | undefined);
      const rpMessageCode = installBody.messageCode as string | undefined;
      // Give the two "wrong mode" rejections their own error_code so the frontend
      // can offer a "switch to login/signup" CTA instead of parsing message text.
      const errorCode =
        rpMessageCode === 'OS_SIGNUP_E1'
          ? 'RP_MERCHANT_ALREADY_EXISTS'
          : rpMessageCode === 'OS_LOGIN_E1'
            ? 'RP_MERCHANT_NOT_FOUND'
            : 'RP_REJECTED';
      this.logger.error(
        {
          merchantId,
          domain: storeDomain,
          side: 'return-prime',
          reason: 'rejected',
          status: res.status,
          installBody,
        },
        'os-install: RP rejected registration',
      );
      throw new BadGatewayException({
        message: rpMessage
          ? `Return Prime rejected registration: ${rpMessage}`
          : 'Return Prime rejected registration.',
        error_code: errorCode,
        side: 'return-prime',
        reason: 'rejected',
        rp: installBody,
      });
    }

    // Only now — a genuine confirmed 2xx from RP — persist domain + registered.
    // `linked_existing_shopify_store`: this merchant already has RP configured via an
    // existing Shopify store (GoKwik assigns the same merchant_id across a merchant's
    // Shopify and OS storefronts when traffic is split between them) — RP recognized
    // that and returned its existing record instead of creating a new one. Use RP's
    // own canonical `store_url` (not whatever the admin typed) so future OS requests'
    // `X-OS-Store` header keeps matching the store RP actually has on file.
    const installData = (installBody.data ?? {}) as Record<string, unknown>;
    const linkedExistingShopifyStore = Boolean(installData.linked_existing_shopify_store);
    // For a dual-platform link, RP's `store_url` is the *Shopify* identity's domain —
    // never persist it as this adapter's own `domain`. This adapter only ever serves
    // the OS side (RP calls it exclusively via `os_store_url`, see createStoreApi.js),
    // so `domain` must stay the OS domain the merchant registered under (`storeDomain`,
    // already correct going into this call) — overwriting it here used to be exactly
    // the bug: a later RP-initiated call keyed on the OS domain would 401 "merchant not
    // installed" because `domain` had been silently swapped for the Shopify one.
    const confirmedDomain = linkedExistingShopifyStore
      ? storeDomain
      : ((installData.store_url as string | undefined) ?? storeDomain);

    if (confirmedDomain !== merchant.domain) {
      await this.merchants.updateDomain(merchantId, confirmedDomain);
    }
    await this.merchants.setRpRegistered(merchantId, true);

    if (linkedExistingShopifyStore) {
      this.logger.log(
        { merchantId, domain: confirmedDomain },
        'os-install: linked to existing Shopify RP account (dual-platform merchant)',
      );
      // Snapshot of the merchant's pre-link plan, captured by RP right before it
      // overwrote plan/pricing_plan_details with the free ENTERPRISE_OS tier — persist
      // it so it can be sent back to RP's os-uninstall endpoint on a real disable,
      // restoring the original plan. Absent on a no-op re-login (RP has nothing new
      // to snapshot) — leave whatever's already stored from the original link alone.
      if (installData.previous_plan) {
        await this.merchants.setPreviousPlan(merchantId, installData.previous_plan);
      }
    } else {
      this.logger.log(
        { merchantId, domain: confirmedDomain },
        'os-install: RP confirmed registration',
      );
    }

    // Registration succeeded — kick off the OS→RP catalog import so RP has products
    // for the exchange picker. Fire-and-forget: never block/fail the register response.
    // Skip it for an already-linked Shopify store — that store's catalog is already
    // synced from its own Shopify install; re-running OS catalog sync against it would
    // overwrite real Shopify product/variant ids with OS-side hashed ones.
    if (!linkedExistingShopifyStore) {
      this.catalogSync
        .syncCatalog(merchantId)
        .catch((err) =>
          this.logger.error(
            { merchantId, side: 'rp-adapter', reason: 'catalog_sync_failed', err },
            'catalog sync trigger failed',
          ),
        );
    }

    return {
      registered: true,
      domain: confirmedDomain,
      alreadyLinked: linkedExistingShopifyStore,
      status: installBody.status ?? installBody.message,
    };
  }
}
