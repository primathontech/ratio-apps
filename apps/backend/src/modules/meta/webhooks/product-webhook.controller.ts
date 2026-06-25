import { Body, Controller, Headers, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { RedisService } from '../cache/redis.service';
import { CatalogService } from '../catalog/catalog.service';
import type { OsItemProduct } from '../catalog/catalog.types';
import { RatioWebhookSignatureGuard } from './ratio-signature.guard';

/**
 * Ratio product-webhook receiver (Phase 2 incremental sync).
 *
 * Actual platform payload (confirmed from live traffic):
 *   headers: x-webhook-topic: products/create|products/update|products/delete
 *            x-merchant-id: <merchantId>
 *   body:    { event_type:"products/update", merchant_id:"…", product:{ …product… } }
 *
 * Note: no x-ratio-signature in platform webhooks — signature guard passes when
 * RATIO_META_WEBHOOK_SECRET is unset (required for production).
 */
@Controller('meta/api/v1/webhooks')
@UseGuards(RatioWebhookSignatureGuard)
export class MetaProductWebhookController {
  private readonly logger = new Logger(MetaProductWebhookController.name);

  constructor(
    private readonly catalog: CatalogService,
    private readonly redis: RedisService,
  ) {}

  @Post('products')
  @HttpCode(200)
  async receive(
    @Headers('x-webhook-topic') topicHeader: string | undefined,
    @Headers('x-merchant-id') merchantHeader: string | undefined,
    @Body() body: RatioWebhookBody,
  ): Promise<{ received: boolean; queued?: boolean; reason?: string }> {
    // Accept both slash-notation (platform) and dot-notation (legacy PRD spec).
    const rawEvent = topicHeader ?? body?.event_type ?? body?.event ?? '';
    const event = this.normalizeEvent(rawEvent);

    const product = (body?.product ?? body?.data ?? {}) as Record<string, unknown>;
    const merchantId =
      merchantHeader ||
      (typeof body?.merchant_id === 'string' ? body.merchant_id : '') ||
      (typeof product.merchant_id === 'string' ? product.merchant_id : '') ||
      (typeof product.storeId === 'string' ? product.storeId : '') ||
      '';

    this.logger.log({ msg: 'product webhook received', merchantId, event, rawEvent });

    if (!merchantId) {
      this.logger.warn({ msg: 'webhook missing merchant id', event });
      return { received: true, queued: false, reason: 'no merchant id' };
    }

    // Idempotency: process each webhook delivery id at most once (48h window).
    const dedupKey = body?.id ?? body?.webhook_id;
    if (dedupKey) {
      const fresh = await this.redis.firstSeen(`evt:webhook:${dedupKey}`, 60 * 60 * 48);
      if (!fresh) {
        this.logger.log({ msg: 'webhook duplicate skipped', merchantId, event, dedupKey });
        return { received: true, queued: false, reason: 'duplicate' };
      }
    }

    if (event === 'product.deleted') {
      const sourceProductId = String(product.id ?? product.product_id ?? '');
      if (!sourceProductId) return { received: true, queued: false, reason: 'no product id' };
      await this.catalog.syncProductWebhook(merchantId, { action: 'delete', sourceProductId });
    } else if (event === 'product.created' || event === 'product.updated') {
      await this.catalog.syncProductWebhook(merchantId, { action: 'upsert', product: product as unknown as OsItemProduct });
    } else {
      this.logger.warn({ msg: 'webhook unrecognised event — ignored', merchantId, event, rawEvent });
      return { received: true, queued: false, reason: `ignored event ${rawEvent}` };
    }

    this.logger.log({ msg: 'product webhook applied', merchantId, event });
    return { received: true, queued: true };
  }

  /** Map slash-notation platform events to dot-notation internal events. */
  private normalizeEvent(raw: string): string {
    const map: Record<string, string> = {
      'products/create': 'product.created',
      'products/update': 'product.updated',
      'products/delete': 'product.deleted',
    };
    return map[raw] ?? raw;
  }
}

interface RatioWebhookBody {
  id?: string;
  webhook_id?: string;
  event?: string;
  event_type?: string;
  created_at?: string;
  merchant_id?: string;
  /** Platform actual shape: product at top level. */
  product?: Record<string, unknown>;
  /** Legacy PRD shape: product nested under data. */
  data?: Record<string, unknown>;
}
