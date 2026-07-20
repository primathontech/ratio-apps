import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { RatioClient, RatioRequestOptions } from '../../../core/ratio-client/ratio.client';
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
 * One page of the platform order list. The API's `pagination.total` counts
 * RAW paid+unfulfilled orders (cancelled/already-shipped included), so only
 * the has-next/has-prev cursors are surfaced, never a total.
 */
export interface OrdersPage {
  orders: Rec[];
  page: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * The platform-orders seam the shipment/tracking services depend on. Injected
 * via `DELHIVERY_ORDERS` so unit tests swap a fake without touching the
 * network. All calls authenticate with the merchant's Ratio access token
 * (refreshed/rotated by {@link RatioTokenProvider}).
 */
export interface RatioOrdersPort {
  getOrder(merchantId: string, orderId: string): Promise<Rec | null>;
  /** Single-`v1` `GET /api/v1/orders` page, optionally filtered by status. */
  listOrders(
    merchantId: string,
    opts: { financialStatus?: string; fulfillmentStatus?: string; limit?: number; page?: number },
  ): Promise<OrdersPage>;
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
 * {@link RatioOrdersPort} over the platform REST API. Per the ecosystem spec,
 * orders are single-`v1` (`/api/v1/orders/{id}`); products stay double-`v1`.
 */
@Injectable()
export class RatioOrdersService implements RatioOrdersPort {
  private readonly logger = new Logger(RatioOrdersService.name);

  constructor(
    private readonly tokens: RatioTokenProvider,
    @Inject(DELHIVERY_RATIO) private readonly ratio: RatioClient,
  ) {}

  /** Bearer token + tenant header; the platform 400s without `gk-merchant-id`. */
  private async authOpts(merchantId: string): Promise<RatioRequestOptions> {
    const accessToken = await this.tokens.getAccessToken(merchantId);
    return { accessToken, headers: { 'gk-merchant-id': merchantId } };
  }

  async getOrder(merchantId: string, orderId: string): Promise<Rec | null> {
    try {
      const env = await this.ratio.request(
        `/api/v1/orders/${encodeURIComponent(orderId)}`,
        anyObjectSchema,
        await this.authOpts(merchantId),
      );
      const order = (env as Rec).order ?? (env as Rec).data ?? env;
      return order && typeof order === 'object' ? (order as Rec) : null;
    } catch (err) {
      if (isUpstreamNotFound(err)) return null;
      throw err;
    }
  }

  async listOrders(
    merchantId: string,
    opts: { financialStatus?: string; fulfillmentStatus?: string; limit?: number; page?: number },
  ): Promise<OrdersPage> {
    const qs = new URLSearchParams({ sort_field: 'created_at', sort_direction: 'desc' });
    if (opts.financialStatus) qs.set('financial_status', opts.financialStatus);
    if (opts.fulfillmentStatus) qs.set('fulfillment_status', opts.fulfillmentStatus);
    if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
    if (opts.page !== undefined) qs.set('page', String(opts.page));
    try {
      const env = await this.ratio.request(
        `/api/v1/orders?${qs.toString()}`,
        anyObjectSchema,
        await this.authOpts(merchantId),
      );
      const list = (env as Rec).orders ?? (env as Rec).data ?? env;
      const pagination = ((env as Rec).pagination ?? {}) as Rec;
      return {
        orders: Array.isArray(list) ? (list as Rec[]) : [],
        page: typeof pagination.page === 'number' ? pagination.page : (opts.page ?? 1),
        hasNext: pagination.hasNextPage === true,
        hasPrev: pagination.hasPreviousPage === true,
      };
    } catch (err) {
      if (isUpstreamNotFound(err)) {
        return { orders: [], page: opts.page ?? 1, hasNext: false, hasPrev: false };
      }
      throw err;
    }
  }

  async getProduct(merchantId: string, productId: string): Promise<Rec | null> {
    try {
      const env = await this.ratio.request(
        `/api/v1/v1/products/${encodeURIComponent(productId)}?show_variants=true`,
        anyObjectSchema,
        await this.authOpts(merchantId),
      );
      const product = (env as Rec).product ?? (env as Rec).data ?? env;
      return product && typeof product === 'object' ? (product as Rec) : null;
    } catch (err) {
      if (isUpstreamNotFound(err)) return null;
      throw err;
    }
  }

  async patchOrder(merchantId: string, orderId: string, patch: Rec): Promise<void> {
    await this.ratio.request(`/api/v1/orders/${encodeURIComponent(orderId)}`, anyObjectSchema, {
      ...(await this.authOpts(merchantId)),
      method: 'PATCH',
      body: patch,
    });
  }

  async setExternalOrderId(merchantId: string, orderId: string, externalId: string): Promise<void> {
    await this.ratio.request(
      `/api/v1/orders/${encodeURIComponent(orderId)}/external-id`,
      anyObjectSchema,
      { ...(await this.authOpts(merchantId)), method: 'PATCH', body: { external_order_id: externalId } },
    );
  }

  async incrementStock(merchantId: string, items: RestockItem[]): Promise<void> {
    if (items.length === 0) return;
    await this.ratio.request('/api/v1/v1/inventory/increment_stock', anyObjectSchema, {
      ...(await this.authOpts(merchantId)),
      method: 'POST',
      body: {
        items: items.map((i) => ({
          product_id: i.productId,
          ...(i.variantId ? { variant_id: i.variantId } : {}),
          quantity: i.quantity,
        })),
      },
    });
  }

  async createRefund(merchantId: string, orderId: string): Promise<void> {
    await this.ratio.request(
      `/api/v1/orders/${encodeURIComponent(orderId)}/refunds`,
      anyObjectSchema,
      { ...(await this.authOpts(merchantId)), method: 'POST', body: { reason: 'rto_completed' } },
    );
    this.logger.log({ msg: 'refund triggered for RTO', merchantId, orderId });
  }
}
