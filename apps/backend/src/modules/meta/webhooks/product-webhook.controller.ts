import { Body, Controller, Headers, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { RedisService } from '../cache/redis.service';
import { CatalogService } from '../catalog/catalog.service';
import type { OsItemProduct } from '../catalog/catalog.types';
import { RatioWebhookSignatureGuard } from './ratio-signature.guard';

/**
 * Ratio product-webhook receiver (Phase 2 incremental sync).
 *
 * Assumed payload (per the dev-portal contract):
 *   headers: X-Ratio-Event: product.created|product.updated|product.deleted
 *            X-Ratio-Signature: <hmac>
 *   body:    { id:"evt_…", event:"product.updated", created_at, data:{ …product… } }
 *
 * The merchant is taken from a header or the payload (data.storeId / merchant_id).
 * We verify the signature, dedupe on the event id, enqueue a catalog op, and
 * return 200 immediately — the catalog worker does the Meta push.
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
    @Headers('x-ratio-event') eventHeader: string | undefined,
    @Headers('x-gk-merchant-id') merchantHeader: string | undefined,
    @Body() body: RatioWebhookBody,
  ): Promise<{ received: boolean; queued?: boolean; reason?: string }> {
    const event = eventHeader ?? body?.event ?? '';
    const data = (body?.data ?? {}) as Record<string, unknown>;
    const merchantId =
      merchantHeader ||
      (typeof data.merchant_id === 'string' ? data.merchant_id : '') ||
      (typeof data.storeId === 'string' ? data.storeId : '') ||
      (typeof body?.merchant_id === 'string' ? body.merchant_id : '') ||
      '';

    if (!merchantId) {
      this.logger.warn({ msg: 'webhook missing merchant id', event });
      return { received: true, queued: false, reason: 'no merchant id' };
    }

    // Idempotency: process each webhook event id at most once (48h window).
    if (body?.id) {
      const fresh = await this.redis.firstSeen(`evt:webhook:${body.id}`, 60 * 60 * 48);
      if (!fresh) return { received: true, queued: false, reason: 'duplicate' };
    }

    // Catalog has no queue — push the single product straight to Meta. If it
    // fails, throw so the caller can retry (we don't silently 200 a lost event).
    if (event === 'product.deleted') {
      const sourceProductId = String(data.id ?? data.product_id ?? '');
      if (!sourceProductId) return { received: true, queued: false, reason: 'no product id' };
      await this.catalog.syncProductWebhook(merchantId, { action: 'delete', sourceProductId });
    } else if (event === 'product.created' || event === 'product.updated') {
      await this.catalog.syncProductWebhook(merchantId, { action: 'upsert', product: data as unknown as OsItemProduct });
    } else {
      return { received: true, queued: false, reason: `ignored event ${event}` };
    }
    this.logger.log({ msg: 'product webhook applied', merchantId, event });
    return { received: true, queued: true };
  }
}

interface RatioWebhookBody {
  id?: string;
  event?: string;
  created_at?: string;
  merchant_id?: string;
  data?: Record<string, unknown>;
}
