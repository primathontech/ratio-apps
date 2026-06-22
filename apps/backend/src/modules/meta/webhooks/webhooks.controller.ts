import { Body, Controller, Headers, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import type { WebhooksService } from '../../../core/webhooks/webhooks.service';
import { type WebhookEnvelope, webhookEnvelopeSchema } from '../../../core/webhooks/webhooks.types';
import type { MetaDatabase } from '../db/types';
import { MetaWebhookSignatureGuard } from '../guards';
import { META_WEBHOOKS } from '../tokens';

/**
 * Inbound Ratio webhooks for Meta. Single endpoint per app — dispatch is
 * by `envelope.event` inside the per-module WebhooksService. Must return 200
 * within 5 s per Ratio's spec — handlers do only cheap synchronous DB work.
 *
 * The signature guard is a `@Injectable()` class that closes over
 * `RATIO_META_CLIENT_SECRET` via DI on first invocation. No global state.
 */
@Controller('meta/api/v1/oauth')
@UseGuards(MetaWebhookSignatureGuard)
export class MetaWebhooksController {
  constructor(@Inject(META_WEBHOOKS) private readonly webhooks: WebhooksService<MetaDatabase>) {}

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
