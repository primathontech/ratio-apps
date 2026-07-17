import { Controller, Logger, Post, Headers, Req, HttpCode, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { RpWebhookSignatureGuard } from '../guards';
import { RpWebhooksService } from './webhooks.service';

/**
 * Inbound webhooks for the RP adapter.
 *
 * OS order service webhook shape (confirmed from MetaProductWebhookController live traffic):
 *   Headers:
 *     x-merchant-id:    <merchantId>
 *     x-webhook-topic:  orders/create | orders/update | orders/fulfilled | orders/cancelled
 *   Body:
 *     { event_type: "orders/create", merchant_id: "…", id: "<delivery-id>", order: { …order… } }
 *
 * No x-ratio-hmac-sha256 on OS order service webhooks — signature guard passes
 * transparently in dev/non-production (same behaviour as MetaProductWebhookController).
 */
@Controller('rp/webhooks')
@UseGuards(RpWebhookSignatureGuard)
export class RpWebhooksController {
  private readonly logger = new Logger(RpWebhooksController.name);

  constructor(private readonly webhooks: RpWebhooksService) {}

  // ── RP internal product webhooks (uses X-GK-Merchant-Id from RP BE) ────────────────────────

  @Post('product-create')
  @HttpCode(200)
  async productCreate(
    @Headers('x-gk-merchant-id') merchantId: string,
    @Req() req: FastifyRequest,
  ) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    this.webhooks.handleProductCreate(merchantId, body).catch(() => {});
    return { ok: true };
  }

  @Post('product-update')
  @HttpCode(200)
  async productUpdate(
    @Headers('x-gk-merchant-id') merchantId: string,
    @Req() req: FastifyRequest,
  ) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    this.webhooks.handleProductUpdate(merchantId, body).catch(() => {});
    return { ok: true };
  }

  // ── OS order service order webhooks ─────────────────────────────────────────────────────────

  /**
   * Single catch-all endpoint — register this one URL on the OS order service for ALL order topics.
   *
   *   POST https://vp2j76nj-3100.inc1.devtunnels.ms/rp/webhooks/orders
   *
   * Topics: orders/create, orders/update, orders/fulfilled, orders/cancelled
   * All topics upsert the latest order state into RP's MongoDB — no branching.
   */
  @Post('orders')
  @HttpCode(200)
  async orderEvent(
    @Headers('x-merchant-id') merchantIdHeader: string,
    @Headers('x-gk-merchant-id') merchantIdFallback: string,
    @Headers('x-webhook-topic') topic: string,
    @Req() req: FastifyRequest,
  ) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const merchantId =
      merchantIdHeader ||
      merchantIdFallback ||
      (typeof body.merchant_id === 'string' ? body.merchant_id : '');

    const orderPayload =
      (body.order as Record<string, unknown> | undefined) ??
      (body.data as Record<string, unknown> | undefined) ??
      body;

    this.webhooks.handleOrderEvent(merchantId, orderPayload, String(topic ?? '')).catch((err) => {
      this.logger.error({ err, merchantId, topic }, 'order event handler failed');
    });
    return { ok: true };
  }

  // ── OS app lifecycle webhook ─────────────────────────────────────────────────────────────────

  /**
   * Fires when the merchant uninstalls/disables the OS↔RP integration.
   *
   *   POST https://vp2j76nj-3100.inc1.devtunnels.ms/rp/webhooks/app-uninstalled
   *
   * Topic: app/uninstalled (matches WIZZY_WEBHOOK_TOPICS.appUninstalled convention).
   * Mirrors RP's own uninstall webhook, which flips `StoreDetail.active = false` —
   * without this, `return_prime_merchants.active` never gets cleared and
   * `RpRequestGuard`/`findByDomain` never closes off portal access.
   */
  @Post('app-uninstalled')
  @HttpCode(200)
  async appUninstalled(
    @Headers('x-merchant-id') merchantIdHeader: string,
    @Headers('x-gk-merchant-id') merchantIdFallback: string,
    @Req() req: FastifyRequest,
  ) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const merchantId =
      merchantIdHeader ||
      merchantIdFallback ||
      (typeof body.merchant_id === 'string' ? body.merchant_id : '');

    this.webhooks.handleAppUninstalled(merchantId).catch((err) => {
      this.logger.error({ err, merchantId }, 'app uninstalled handler failed');
    });
    return { ok: true };
  }

  // Individual topic endpoints kept for explicitness / future differentiation

  @Post('orders/create')
  @HttpCode(200)
  async orderCreate(
    @Headers('x-merchant-id') merchantIdHeader: string,
    @Headers('x-gk-merchant-id') merchantIdFallback: string,
    @Req() req: FastifyRequest,
  ) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const merchantId = merchantIdHeader || merchantIdFallback || (body.merchant_id as string) || '';
    const orderPayload = (body.order as Record<string, unknown>) ?? (body.data as Record<string, unknown>) ?? body;
    this.webhooks.handleOrderEvent(merchantId, orderPayload, 'orders/create').catch(() => {});
    return { ok: true };
  }

  @Post('orders/update')
  @HttpCode(200)
  async orderUpdate(
    @Headers('x-merchant-id') merchantIdHeader: string,
    @Headers('x-gk-merchant-id') merchantIdFallback: string,
    @Req() req: FastifyRequest,
  ) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const merchantId = merchantIdHeader || merchantIdFallback || (body.merchant_id as string) || '';
    const orderPayload = (body.order as Record<string, unknown>) ?? (body.data as Record<string, unknown>) ?? body;
    this.webhooks.handleOrderEvent(merchantId, orderPayload, 'orders/update').catch(() => {});
    return { ok: true };
  }
}
