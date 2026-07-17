import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { RatioClient } from '../../../core/ratio-client/ratio.client';
import { RatioTokenProvider } from '../oauth/ratio-token.provider';
import { DELHIVERY_RATIO } from '../tokens';

type Rec = Record<string, unknown>;

// Tolerant envelopes — platform wrapper shapes vary by environment (see the
// google module's RatioProductsService); locate the entity defensively.
const anyObjectSchema = z.record(z.string(), z.unknown());

/** One RTO restock line. */
export interface RestockItem {
  productId: string;
  variantId?: string;
  quantity: number;
}

/**
 * The platform-orders seam the shipment/tracking services depend on. Injected
 * via `DELHIVERY_ORDERS` so unit tests swap a fake without touching the
 * network. All calls authenticate with the merchant's Ratio access token
 * (refreshed/rotated by {@link RatioTokenProvider}).
 */
export interface RatioOrdersPort {
  getOrder(merchantId: string, orderId: string): Promise<Rec | null>;
  getProduct(merchantId: string, productId: string): Promise<Rec | null>;
  /** `PATCH /orders/{id}` — mirror fulfillment_status + tracking summary. */
  patchOrder(merchantId: string, orderId: string, patch: Rec): Promise<void>;
  /** `PATCH /orders/{id}/external-id` — bind the AWB as the external order id. */
  setExternalOrderId(merchantId: string, orderId: string, externalId: string): Promise<void>;
  /** Inventory `increment_stock` — RTO restock. */
  incrementStock(merchantId: string, items: RestockItem[]): Promise<void>;
  /** Trigger a refund on the order (prepaid RTO). */
  createRefund(merchantId: string, orderId: string): Promise<void>;
}

/** True when a RatioClient error wraps an upstream 404. */
function isUpstreamNotFound(err: unknown): boolean {
  if (!(err instanceof HttpException)) return false;
  const body = err.getResponse();
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { details?: { status?: number } }).details?.status === 404
  );
}

/**
 * Concrete {@link RatioOrdersPort} over the platform REST API (same
 * `/api/v1/v1/...` mount the google module's product source uses).
 */
@Injectable()
export class RatioOrdersService implements RatioOrdersPort {
  private readonly logger = new Logger(RatioOrdersService.name);

  constructor(
    private readonly tokens: RatioTokenProvider,
    @Inject(DELHIVERY_RATIO) private readonly ratio: RatioClient,
  ) {}

  async getOrder(merchantId: string, orderId: string): Promise<Rec | null> {
    const accessToken = await this.tokens.getAccessToken(merchantId);
    try {
      const env = await this.ratio.request(
        `/api/v1/v1/orders/${encodeURIComponent(orderId)}`,
        anyObjectSchema,
        { accessToken },
      );
      const order = (env as Rec).order ?? (env as Rec).data ?? env;
      return order && typeof order === 'object' ? (order as Rec) : null;
    } catch (err) {
      if (isUpstreamNotFound(err)) return null;
      throw err;
    }
  }

  async getProduct(merchantId: string, productId: string): Promise<Rec | null> {
    const accessToken = await this.tokens.getAccessToken(merchantId);
    try {
      const env = await this.ratio.request(
        `/api/v1/v1/products/${encodeURIComponent(productId)}?show_variants=true`,
        anyObjectSchema,
        { accessToken },
      );
      const product = (env as Rec).product ?? (env as Rec).data ?? env;
      return product && typeof product === 'object' ? (product as Rec) : null;
    } catch (err) {
      if (isUpstreamNotFound(err)) return null;
      throw err;
    }
  }

  async patchOrder(merchantId: string, orderId: string, patch: Rec): Promise<void> {
    const accessToken = await this.tokens.getAccessToken(merchantId);
    await this.ratio.request(`/api/v1/v1/orders/${encodeURIComponent(orderId)}`, anyObjectSchema, {
      method: 'PATCH',
      body: patch,
      accessToken,
    });
  }

  async setExternalOrderId(merchantId: string, orderId: string, externalId: string): Promise<void> {
    const accessToken = await this.tokens.getAccessToken(merchantId);
    await this.ratio.request(
      `/api/v1/v1/orders/${encodeURIComponent(orderId)}/external-id`,
      anyObjectSchema,
      { method: 'PATCH', body: { external_order_id: externalId }, accessToken },
    );
  }

  async incrementStock(merchantId: string, items: RestockItem[]): Promise<void> {
    if (items.length === 0) return;
    const accessToken = await this.tokens.getAccessToken(merchantId);
    await this.ratio.request('/api/v1/v1/inventory/increment_stock', anyObjectSchema, {
      method: 'POST',
      body: {
        items: items.map((i) => ({
          product_id: i.productId,
          ...(i.variantId ? { variant_id: i.variantId } : {}),
          quantity: i.quantity,
        })),
      },
      accessToken,
    });
  }

  async createRefund(merchantId: string, orderId: string): Promise<void> {
    const accessToken = await this.tokens.getAccessToken(merchantId);
    await this.ratio.request(
      `/api/v1/v1/orders/${encodeURIComponent(orderId)}/refunds`,
      anyObjectSchema,
      { method: 'POST', body: { reason: 'rto_completed' }, accessToken },
    );
    this.logger.log({ msg: 'refund triggered for RTO', merchantId, orderId });
  }
}
