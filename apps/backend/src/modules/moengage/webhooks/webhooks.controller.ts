import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import type { WebhooksService } from '../../../core/webhooks/webhooks.service';
import { type WebhookEnvelope, webhookEnvelopeSchema } from '../../../core/webhooks/webhooks.types';
import type { MoengageDatabase } from '../db/types';
import { MoengageWebhookSignatureGuard } from '../guards';
import { MOENGAGE_WEBHOOKS } from '../tokens';

@Controller('moengage/api/v1/oauth')
@UseGuards(MoengageWebhookSignatureGuard)
export class MoengageWebhooksController {
  constructor(
    @Inject(MOENGAGE_WEBHOOKS) private readonly webhooks: WebhooksService<MoengageDatabase>,
  ) {}

  /**
   * Single inbound endpoint for the MoEngage module. Ratio sends every topic
   * here; dispatch is by `envelope.event` (e.g. "app.uninstalled"). Must
   * return 200 within 5 s per Ratio's spec — handlers do only cheap
   * synchronous work (DB updates). Event capture itself is done by the
   * storefront pixel directly to MoEngage.
   *
   * Path: POST /moengage/api/v1/oauth/webhook
   *   - Co-located with the OAuth callback so Ratio only needs one base
   *     URL per app.
   *   - `MoengageWebhookSignatureGuard` is a static host class that delegates
   *     to a factory-produced guard pre-bound to `RATIO_MOENGAGE_CLIENT_SECRET`.
   */
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
