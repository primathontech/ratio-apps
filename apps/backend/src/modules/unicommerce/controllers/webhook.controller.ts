import { Body, Controller, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { webhookEnvelopeSchema } from '../../../core/webhooks/webhooks.types';
import type { WebhookEnvelope } from '../../../core/webhooks/webhooks.types';
import { UcWebhookSignatureGuard } from '../guards';
import { UC_WEBHOOKS } from '../tokens';
import { Inject } from '@nestjs/common';
import type { WebhooksService } from '../../../core/webhooks/webhooks.service';
import type { UnicommerceDatabase } from '../db/types';

@Controller('unicommerce/api/v1/oauth')
@UseGuards(UcWebhookSignatureGuard)
export class UcWebhookController {
  constructor(
    @Inject(UC_WEBHOOKS)
    private readonly webhooks: WebhooksService<UnicommerceDatabase>,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async receive(
    @Body(new ZodValidationPipe(webhookEnvelopeSchema)) envelope: WebhookEnvelope,
    @Headers('x-webhook-id') deliveryId?: string,
  ): Promise<{ ok: true }> {
    await this.webhooks.dispatch(envelope, deliveryId);
    return { ok: true };
  }
}
