import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import type { WebhooksService } from '../../../core/webhooks/webhooks.service';
import { type WebhookEnvelope, webhookEnvelopeSchema } from '../../../core/webhooks/webhooks.types';
import type { PosthogDatabase } from '../db/types';
import { PosthogWebhookSignatureGuard } from '../guards';
import { POSTHOG_WEBHOOKS } from '../tokens';

/**
 * Inbound Ratio webhooks for PostHog. Single endpoint per app — dispatch is
 * by `envelope.event` inside the per-module WebhooksService. Must return 200
 * within 5 s per Ratio's spec — handlers do only cheap synchronous DB work.
 *
 * The signature guard is a `@Injectable()` class that closes over
 * `RATIO_POSTHOG_CLIENT_SECRET` via DI on first invocation. No global state.
 */
@Controller('posthog/api/v1/oauth')
@UseGuards(PosthogWebhookSignatureGuard)
export class PosthogWebhooksController {
  constructor(
    @Inject(POSTHOG_WEBHOOKS) private readonly webhooks: WebhooksService<PosthogDatabase>,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async receive(
    @Body(new ZodValidationPipe(webhookEnvelopeSchema as unknown as ZodType<WebhookEnvelope>))
    envelope: WebhookEnvelope,
  ): Promise<{ ok: true }> {
    await this.webhooks.dispatch(envelope);
    return { ok: true };
  }
}
