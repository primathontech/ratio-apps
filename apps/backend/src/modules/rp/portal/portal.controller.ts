import { Controller, Get, Query, Redirect } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import { RpMerchantsService } from '../merchants/merchants.service';
import { RpOrdersService } from '../orders/orders.service';

/**
 * Adapter-hosted Return Prime customer portal — the OS/headless equivalent of Shopify's
 * App Proxy for `/apps/return_prime`. A headless storefront points its `/apps/return_prime`
 * at this endpoint (directly or via an iframe) and the adapter routes the customer to the RP
 * portal for their store. The portal is platform-agnostic (its /customer/v1/* calls are
 * backed by the adapter for OS), so no OS-specific UI is needed.
 *
 * Target resolution:
 *  - RP_PORTAL_URL set (self-hosted / dev portal — e.g. the return_prime_public_react app):
 *    route by store_url at `{RP_PORTAL_URL}/{shop}`. Required locally, since RP's hosted
 *    shell loads the prod CDN bundle which calls the prod API (api.returnprime.co) and can't
 *    reach a local/OS-integrated RP. The dev portal reads its API base from VITE_AXIOS_URL.
 *  - otherwise: RP's hosted shell `{RP_BASE_URL}/os/v1/customer-portal?shop=…`.
 *
 * Usage: GET /rp/customer/portal?shop=sandbox-bblunt-v2.dev.gokwik.io
 */
@Controller('rp/customer')
export class RpPortalController {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly merchants: RpMerchantsService,
    private readonly orders: RpOrdersService,
  ) {}

  @Get('portal')
  @Redirect()
  async portal(
    @Query('shop') shop?: string,
    @Query('order') order?: string,
    @Query('email') email?: string,
    @Query('orderId') orderId?: string,
  ) {
    // Storefront SDK case: caller only knows the raw OS order id (from the page URL/DOM,
    // e.g. ordr_XXXX), not the display order name — that lives only in the order record.
    // Resolve just the NAME here so the SDK never needs page-specific wiring. Deliberately
    // does NOT resolve email/phone from orderId alone: unlike order/email passthrough below
    // (which only forwards values the caller already supplied), resolving PII from a bare
    // order id — with no proof the caller is entitled to it — is a disclosure oracle (anyone
    // who can see/guess an orderId gets the owner's email/phone back). The customer types
    // their own email/phone on RP's portal, same as every other find-order flow.
    // Best-effort: an unresolved lookup still redirects (unprefilled) rather than erroring —
    // a customer who reaches this page can always type their order number themselves too.
    let resolvedOrder = order;
    if (orderId && !resolvedOrder && shop) {
      try {
        const merchant = await this.merchants.findByDomain(shop);
        if (merchant) {
          const result = (await this.orders.getOrder(merchant.merchantId, orderId)) as {
            order?: { external_order_name?: string; name?: string };
          };
          resolvedOrder = result.order?.external_order_name ?? result.order?.name;
        }
      } catch {
        /* fall through unprefilled */
      }
    }

    // `order`/`email` deep-link a specific order + customer (from the storefront Order History
    // Return/Exchange link) so the RP portal can prefill the order number and email/phone.
    const prefillQs = [
      resolvedOrder ? `order=${encodeURIComponent(resolvedOrder)}` : '',
      email ? `email=${encodeURIComponent(email)}` : '',
    ]
      .filter(Boolean)
      .join('&');
    // Read from process.env directly: RP_PORTAL_URL is not in the validated Env schema, so
    // ConfigService strips it. dotenv still populates process.env.
    const portalUrl = process.env.RP_PORTAL_URL;
    if (portalUrl) {
      const base = portalUrl.replace(/\/$/, '');
      const target = shop ? `${base}/${encodeURIComponent(shop)}` : base;
      return { url: prefillQs ? `${target}?${prefillQs}` : target, statusCode: 302 };
    }
    const baseUrl = this.config.get('RP_BASE_URL', { infer: true }) as string;
    const params = [shop ? `shop=${encodeURIComponent(shop)}` : '', prefillQs].filter(Boolean).join('&');
    return { url: `${baseUrl}/os/v1/customer-portal${params ? `?${params}` : ''}`, statusCode: 302 };
  }
}
