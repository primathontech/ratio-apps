import { Body, Controller, Headers, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { webhookEnvelopeSchema, type WebhookEnvelope } from '../../../core/webhooks/webhooks.types';
import type { WebhooksService } from '../../../core/webhooks/webhooks.service';
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
@Controller('unicommerce/webhooks')
@UseGuards(UcWebhookSignatureGuard)
export class UcWebhooksController {
  constructor(
    @Inject(UC_WEBHOOKS) private readonly webhooks: WebhooksService<UnicommerceDatabase>,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Body(new ZodValidationPipe(webhookEnvelopeSchema as unknown as ZodType<WebhookEnvelope>))
    envelope: WebhookEnvelope,
    @Headers('x-webhook-id') deliveryId?: string,
  ): Promise<{ ok: true }> {
    await this.webhooks.dispatch(envelope, deliveryId);
    return { ok: true };
  }
}
