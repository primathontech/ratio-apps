import { Body, Controller, Headers, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import type { WebhooksService } from '../../../core/webhooks/webhooks.service';
import { type WebhookEnvelope, webhookEnvelopeSchema } from '../../../core/webhooks/webhooks.types';
import type { ClevertapDatabase } from '../db/types';
import { ClevertapWebhookSignatureGuard } from '../guards';
import { CLEVERTAP_WEBHOOKS } from '../tokens';

@Controller('clevertap/api/v1/oauth')
@UseGuards(ClevertapWebhookSignatureGuard)
export class ClevertapWebhooksController {
  constructor(
    @Inject(CLEVERTAP_WEBHOOKS) private readonly webhooks: WebhooksService<ClevertapDatabase>,
  ) {}

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

@Controller()
@UseGuards(ClevertapWebhookSignatureGuard)
export class ClevertapWebhooksCompatController {
  constructor(
    @Inject(CLEVERTAP_WEBHOOKS) private readonly webhooks: WebhooksService<ClevertapDatabase>,
  ) {}

  @Post('webhooks')
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
