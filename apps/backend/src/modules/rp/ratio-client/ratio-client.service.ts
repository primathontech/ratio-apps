import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { RatioClient } from '../../../core/ratio-client/ratio.client';
import type { Env } from '../../../config/env.schema';
import { RP_RATIO_CLIENT } from '../tokens';

const anySchema = z.unknown();

@Injectable()
export class RpRatioClientService {
  private readonly logger = new Logger(`RP:${RpRatioClientService.name}`);

  constructor(
    @Inject(RP_RATIO_CLIENT) private readonly ratio: RatioClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ── Orders (GoKwik OS Order Service) ─────────────────────────────────────

  async getOrders(merchantId: string, params: Record<string, string>): Promise<unknown> {
    const base = this.config.get('OS_ORDER_BASE_URL', { infer: true }) as string;
    if (!base) throw new Error('OS_ORDER_BASE_URL is not configured');
    // GoKwik uses `search` param for order name/number lookup; map Shopify `name` → `search`
    const mapped: Record<string, string> = { ...params };
    if (mapped.name) {
      mapped.search = mapped.name;
      delete mapped.name;
    }
    const qs = new URLSearchParams(mapped).toString();
    const url = `${base}/api/v1/admin/orders${qs ? `?${qs}` : ''}`;
    const res = await fetch(url, {
      headers: { 'gk-merchant-id': merchantId, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      this.logger.error({ merchantId, status: res.status }, 'OS order service error (orders)');
    }
    return res.json();
  }

  async getOrder(merchantId: string, orderId: string): Promise<unknown> {
    const base = this.config.get('OS_ORDER_BASE_URL', { infer: true }) as string;
    if (!base) throw new Error('OS_ORDER_BASE_URL is not configured');
    const headers = { 'gk-merchant-id': merchantId, 'Content-Type': 'application/json' };

    // If a real OS order id (ordr_…) is passed, fetch it directly — the storefront/RP
    // sends this when deep-linking a specific order. Otherwise the value is a
    // Shopify-style order_number (e.g. 2484): search by it to avoid lossy ID hashing.
    if (/^ordr_/i.test(orderId)) {
      const res = await fetch(`${base}/api/v1/admin/orders/${encodeURIComponent(orderId)}`, { headers });
      if (!res.ok) {
        this.logger.error({ merchantId, orderId, status: res.status }, 'OS order service error (order by id)');
      }
      const data = (await res.json()) as Record<string, unknown>;
      const order = ((data?.data as any)?.order ?? (data as any)?.order ?? null) as Record<string, unknown> | null;
      return { order };
    }

    const res = await fetch(`${base}/api/v1/admin/orders?search=${encodeURIComponent(orderId)}`, { headers });
    if (!res.ok) {
      this.logger.error({ merchantId, orderId, status: res.status }, 'OS order service error (order)');
    }
    const data = (await res.json()) as Record<string, unknown>;
    const orders = ((data?.data as any)?.orders ?? (data as any)?.orders ?? []) as Record<string, unknown>[];
    const match = orders.find((o) => String(o.order_number) === String(orderId)) ?? orders[0];
    return { order: match };
  }

  /**
   * Patch an order in OS. RP sends a Shopify-shaped body (`{ order: { tags,
   * fulfillment_status } }`) — e.g. to mark an order returned/exchanged when the
   * "Sync returns status" setting is on. Forward the order fields to the OS order
   * service PATCH. Mirrors osOrderPost's fail-loud behaviour so a rejected patch
   * never comes back looking like a success.
   */
  async patchOrder(merchantId: string, orderId: string, body: unknown): Promise<unknown> {
    const base = this.config.get('OS_ORDER_BASE_URL', { infer: true }) as string;
    if (!base) throw new Error('OS_ORDER_BASE_URL is not configured');
    const order = ((body as Record<string, unknown>)?.order ?? body) as unknown;
    const res = await fetch(`${base}/api/v1/admin/orders/${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: { 'gk-merchant-id': merchantId, 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      this.logger.error({ merchantId, orderId, status: res.status, body: errBody }, 'OS order service error (patch)');
      throw new HttpException(
        { message: `OS order service patch failed`, os: errBody },
        res.status,
      );
    }
    return res.json();
  }

  // ── Discounts (Ratio App Ecosystem API) ──────────────────────────────────

  async createDiscount(accessToken: string, body: unknown): Promise<unknown> {
    return this.ratio.request('/api/v1/discounts', anySchema, {
      method: 'POST',
      accessToken,
      body,
    });
  }

  // ── Customers (Ratio App Ecosystem API) ──────────────────────────────────

  async searchCustomer(accessToken: string, email: string): Promise<unknown> {
    return this.ratio.request(`/api/v1/customers?email=${encodeURIComponent(email)}`, anySchema, {
      accessToken,
    });
  }

  async createCustomer(accessToken: string, body: unknown): Promise<unknown> {
    return this.ratio.request('/api/v1/customers', anySchema, {
      method: 'POST',
      accessToken,
      body,
    });
  }

  // ── Products (GoKwik OS Item Service) ────────────────────────────────────

  /**
   * Fetch a product from the OS Item Service.
   * Auth: gk-merchant-id header (merchant_id from return_prime_merchants).
   * storeId query param: the OS merchant id (NOT the store domain) — the item
   * service only returns the merchant's catalog when storeId === merchantId.
   */
  async getProduct(merchantId: string, _domain: string, productId: string): Promise<unknown> {
    const base = this.config.get('OS_ITEM_BASE_URL', { infer: true }) as string;
    if (!base) throw new Error('OS_ITEM_BASE_URL is not configured');
    const storeId = merchantId;
    const url = `${base}/api/v1/admin/products/${encodeURIComponent(productId)}?storeId=${encodeURIComponent(storeId)}&show_variants=true`;
    const res = await fetch(url, {
      headers: { 'gk-merchant-id': merchantId, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      this.logger.error({ merchantId, productId, status: res.status }, 'OS item service error');
    }
    return res.json();
  }

  /**
   * Page the OS item catalog for a merchant (used by the registration-time catalog
   * import into RP). Returns the page's products plus whether more pages remain.
   */
  async listProducts(
    merchantId: string,
    page: number,
    limit: number,
  ): Promise<{ products: Record<string, unknown>[]; hasNext: boolean }> {
    const base = this.config.get('OS_ITEM_BASE_URL', { infer: true }) as string;
    if (!base) throw new Error('OS_ITEM_BASE_URL is not configured');
    const url = `${base}/api/v1/admin/products?storeId=${encodeURIComponent(merchantId)}&page=${page}&limit=${limit}&show_variants=true`;
    const res = await fetch(url, {
      headers: { 'gk-merchant-id': merchantId, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      this.logger.error({ merchantId, page, status: res.status }, 'OS item service error (list)');
      return { products: [], hasNext: false };
    }
    const data = (await res.json()) as Record<string, any>;
    const products = ((data?.products ?? data?.data?.products ?? []) as Record<string, unknown>[]) || [];
    const hasNext = Boolean(data?.pagination?.hasNext ?? data?.data?.pagination?.hasNext);
    return { products, hasNext };
  }

  // ── Refunds (GoKwik OS Order Service) ────────────────────────────────────

  async calculateRefund(merchantId: string, orderId: string, body: unknown): Promise<unknown> {
    const osId = await this.resolveOsOrderId(merchantId, orderId);
    return this.osOrderPost(
      merchantId,
      '/api/v1/admin/refunds/calculate',
      { ...(body as Record<string, unknown>), order_id: osId },
    );
  }

  async createRefund(merchantId: string, orderId: string, body: unknown): Promise<unknown> {
    const osId = await this.resolveOsOrderId(merchantId, orderId);
    return this.osOrderPost(
      merchantId,
      '/api/v1/admin/refunds',
      { ...(body as Record<string, unknown>), order_id: osId },
    );
  }

  async getRefunds(merchantId: string, orderId: string): Promise<unknown> {
    const base = this.config.get('OS_ORDER_BASE_URL', { infer: true }) as string;
    if (!base) throw new Error('OS_ORDER_BASE_URL is not configured');
    const osId = await this.resolveOsOrderId(merchantId, orderId);
    const url = `${base}/api/v1/admin/orders/${encodeURIComponent(osId)}/refunds`;
    const res = await fetch(url, {
      headers: { 'gk-merchant-id': merchantId, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      this.logger.error({ merchantId, orderId, status: res.status }, 'OS order service error');
    }
    return res.json();
  }

  // Resolves an order_number (e.g. "2484") to the real OS order ID ("ordr_17835966307325080").
  // Needed because normalizeOrder uses order_number as the Shopify id to avoid lossy hashing.
  private async resolveOsOrderId(merchantId: string, orderNumber: string): Promise<string> {
    const base = this.config.get('OS_ORDER_BASE_URL', { infer: true }) as string;
    if (!base) throw new Error('OS_ORDER_BASE_URL is not configured');
    const res = await fetch(`${base}/api/v1/admin/orders?search=${encodeURIComponent(orderNumber)}`, {
      headers: { 'gk-merchant-id': merchantId, 'Content-Type': 'application/json' },
    });
    const data = await res.json() as Record<string, unknown>;
    const orders = ((data?.data as any)?.orders ?? (data as any)?.orders ?? []) as Record<string, unknown>[];
    const match = orders.find((o) => String(o.order_number) === String(orderNumber)) ?? orders[0];
    return String(match?.id ?? orderNumber);
  }

  // ── Order creation (OS Order Service) — exchange fulfillment ────────────────

  /** Create an order in OS (used for exchange orders). Body is already OS-shaped. */
  async createOrder(merchantId: string, body: unknown): Promise<unknown> {
    return this.osOrderPost(merchantId, '/api/v1/admin/orders', body);
  }

  private async osOrderPost(merchantId: string, path: string, body: unknown): Promise<unknown> {
    const base = this.config.get('OS_ORDER_BASE_URL', { infer: true }) as string;
    if (!base) throw new Error('OS_ORDER_BASE_URL is not configured');
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'gk-merchant-id': merchantId, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Surface the failure with the OS status + body — never return an error body as if
      // it were a result (that lets normalizeOrder fabricate a { id: 0 } "order", which RP
      // would record as a successful exchange that created nothing). Preserving the status
      // lets meaningful OS rejections (e.g. ORDER_FULLY_REFUNDED, NOT_REFUNDABLE_ORIGIN)
      // reach RP as a 4xx with the real reason instead of an opaque 500.
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      this.logger.error({ merchantId, path, status: res.status, body }, 'OS order service error');
      throw new HttpException(
        { message: `OS order service ${path} failed`, os: body },
        res.status,
      );
    }
    return res.json();
  }
}
