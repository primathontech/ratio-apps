import { Body, Controller, Headers, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { ZodType } from 'zod';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import type { WebhooksService } from '../../../core/webhooks/webhooks.service';
import { type WebhookEnvelope, webhookEnvelopeSchema } from '../../../core/webhooks/webhooks.types';
import type { UnicommerceDatabase } from '../db/types';
import { UcWebhookSignatureGuard } from '../guards';
import { UC_WEBHOOKS } from '../tokens';

/**
 * Inbound Ratio webhooks for this module — a real HTTP endpoint the platform
 * delivers to, missing from every one of the 16 original tasks (each task
 * built a `WebhookHandler` registered with `WebhooksService`, but nothing
 * ever exposed the endpoint Ratio actually POSTs to). Single endpoint,
 * dispatch is by `envelope.event_type` inside `WebhooksService`. Route is
 * deliberately `unicommerce/webhooks` rather than the `<slug>/api/v1/oauth/webhook`
 * shape `google`/`meta` use for this same purpose — a house-style choice
 * made for this module specifically, not a bug. Must return 200 within 5s.
 */
@ApiTags('unicommerce')
@Controller('unicommerce/webhooks')
@UseGuards(UcWebhookSignatureGuard)
export class UcWebhooksController {
  constructor(
    @Inject(UC_WEBHOOKS) private readonly webhooks: WebhooksService<UnicommerceDatabase>,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Receive a Ratio webhook delivery (topic-routed internally)',
    description:
      'Direction: Ratio to UC connector app. For orders create and orders cancelled events, handling this ' +
      'delivery also triggers an outbound push from the UC connector app to Unicommerce, at ' +
      'genericproxy.unicommerce.com. Called by Ratio, not by Unicommerce, this is the inbound receiver for ' +
      'the module\'s webhook handlers. Dispatch is by the envelope event type. Deliveries are deduped by ' +
      'webhook id and payload fingerprint, retried, and self-healing through the webhook log transaction. ' +
      'Must return 200 within 5 seconds. Known topics routed: orders create for outbound order push, orders ' +
      'cancelled for outbound cancel push, and products create or products update for incremental SKU cache ' +
      'sync.',
  })
  @ApiHeader({
    name: 'x-ratio-hmac-sha256',
    required: true,
    description:
      "HMAC-SHA256 signature of the RAW request body, keyed with this module's client secret " +
      '(`RATIO_UNICOMMERCE_CLIENT_SECRET`). Encoding may be hex or base64 (platform-version dependent); a legacy ' +
      '`sha256=` prefix is tolerated. Verified in constant time. When the header is absent, production rejects the ' +
      'delivery — non-production deployments (or `WEBHOOK_SIGNATURE_OPTIONAL=true`) skip verification with a warning.',
    example: 'sha256=9b2f7a1c8e4d5f0a3b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a',
  })
  @ApiHeader({
    name: 'x-webhook-id',
    required: false,
    description:
      'Optional per-delivery id sent by the platform. Used (bound to a payload fingerprint) for dedupe so genuine re-updates are not suppressed.',
    example: 'evt_01J4K2M8QX9PL7TZ5A3B6C8D',
  })
  @ApiBody({
    required: true,
    description:
      'The webhook envelope (per the OpenStore contract). `event_type` selects the handler; the resource lives at ' +
      "`order` for order events or `product` for product events (top-level `id`, with each variant's own `id` + `sku` " +
      'nested under `variants[]`). `merchant_id` is nullable — resource-less events (e.g. `app/uninstalled`) and ' +
      'unknown-merchant deliveries are no-ops. Extra top-level fields are tolerated.',
    schema: {
      oneOf: [
        {
          type: 'object',
          title: 'orders/create — order push',
          properties: {
            event_type: { type: 'string', enum: ['orders/create'] },
            merchant_id: { type: 'string', nullable: true, example: '195qow8rsryx' },
            order: {
              type: 'object',
              example: {
                id: 'gid://shopify/Order/5432109876543',
                name: '#RAT-1001',
                created_at: '2026-08-05T09:41:00+05:30',
                email: 'asha.sharma@example.in',
                payment_gateway_names: ['cash on delivery (COD)'],
                total_discounts: 50,
                shipping_lines: [{ price: 100 }],
                line_items: [
                  {
                    id: 'gid://shopify/LineItem/1122334455667',
                    product_id: 'gid://shopify/Product/8123456789012',
                    variant_id: 'gid://shopify/Variant/4345678901234',
                    sku: 'CCT-NAVY-S',
                    title: 'Classic Cotton T-Shirt / S / Navy',
                    quantity: 2,
                    price: '699.00',
                  },
                ],
              },
            },
          },
          required: ['event_type'],
        },
        {
          type: 'object',
          title: 'orders/cancelled — cancel push',
          properties: {
            event_type: { type: 'string', enum: ['orders/cancelled'] },
            merchant_id: { type: 'string', nullable: true, example: '195qow8rsryx' },
            order: {
              type: 'object',
              example: {
                id: 'gid://shopify/Order/5432109876543',
                name: '#RAT-1001',
                status: 'cancelled',
                cancelled_at: '2026-08-06T16:20:00+05:30',
                cancel_reason: 'Customer changed mind',
              },
            },
          },
          required: ['event_type'],
        },
        {
          type: 'object',
          title: 'products/create | products/update — SKU cache sync',
          properties: {
            event_type: { type: 'string', enum: ['products/create', 'products/update'] },
            merchant_id: { type: 'string', nullable: true, example: '195qow8rsryx' },
            product: {
              type: 'object',
              example: {
                id: 'gid://shopify/Product/8123456789012',
                title: 'Classic Cotton T-Shirt',
                status: 'active',
                variants: [
                  { id: 'gid://shopify/Variant/4345678901234', sku: 'CCT-NAVY-S' },
                  { id: 'gid://shopify/Variant/4345678901235', sku: 'CCT-NAVY-L' },
                ],
              },
            },
          },
          required: ['event_type'],
        },
      ],
    },
  })
  @ApiResponse({
    status: 200,
    description:
      'Delivery accepted for dispatch (handlers run inside the dispatch transaction). Must answer within 5s.',
    schema: {
      type: 'object',
      properties: { ok: { type: 'boolean', enum: [true], example: true } },
      required: ['ok'],
    },
  })
  async receive(
    @Body(new ZodValidationPipe(webhookEnvelopeSchema as unknown as ZodType<WebhookEnvelope>))
    envelope: WebhookEnvelope,
    @Headers('x-webhook-id') deliveryId?: string,
  ): Promise<{ ok: true }> {
    await this.webhooks.dispatch(envelope, deliveryId);
    return { ok: true };
  }
}
