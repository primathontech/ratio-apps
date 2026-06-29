import { Body, Controller, Headers, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import type { WebhooksService } from '../../../core/webhooks/webhooks.service';
import { type WebhookEnvelope, webhookEnvelopeSchema } from '../../../core/webhooks/webhooks.types';
import type { WizzyDatabase } from '../db/types';
import { WizzyWebhookSignatureGuard } from '../guards';
import { WIZZY_WEBHOOKS } from '../tokens';

/**
 * Inbound Ratio webhooks for Wizzy. Single endpoint — dispatch is by
 * `envelope.event` inside the per-module WebhooksService. Must return 200
 * within 5 s per Ratio's spec — handlers enqueue to SQS and return fast.
 *
 * The `x-webhook-id` header is the per-delivery dedup key (copied from google's
 * controller pattern).
 */
@Controller('wizzy/api/v1/webhooks')
@UseGuards(WizzyWebhookSignatureGuard)
export class WizzyWebhooksController {
  constructor(@Inject(WIZZY_WEBHOOKS) private readonly webhooks: WebhooksService<WizzyDatabase>) {}

  @Post('webhook')
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
