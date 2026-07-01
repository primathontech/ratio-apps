import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { RatioClient } from '../../../core/ratio-client/ratio.client';
import type { Env } from '../../../config/env.schema';
import { RP_RATIO_CLIENT } from '../tokens';

const anySchema = z.unknown();

@Injectable()
export class RpRatioClientService {
  private readonly logger = new Logger(RpRatioClientService.name);

  constructor(
    @Inject(RP_RATIO_CLIENT) private readonly ratio: RatioClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ── Orders (GoKwik OS Order Service) ─────────────────────────────────────

  async getOrders(merchantId: string, params: Record<string, string>): Promise<unknown> {
    const base = this.config.get('OS_ORDER_BASE_URL', { infer: true }) as string;
    if (!base) throw new Error('OS_ORDER_BASE_URL is not configured');
    const qs = new URLSearchParams(params).toString();
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
    const url = `${base}/api/v1/admin/orders/${encodeURIComponent(orderId)}`;
    const res = await fetch(url, {
      headers: { 'gk-merchant-id': merchantId, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      this.logger.error({ merchantId, orderId, status: res.status }, 'OS order service error (order)');
    }
    return res.json();
  }

  async patchOrder(_merchantId: string, _orderId: string, _body: unknown): Promise<unknown> {
    // OS order service patch not yet implemented — return empty success
    return {};
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
   * storeId query param: merchant domain.
   */
  async getProduct(merchantId: string, domain: string, productId: string): Promise<unknown> {
    const base = this.config.get('OS_ITEM_BASE_URL', { infer: true }) as string;
    if (!base) throw new Error('OS_ITEM_BASE_URL is not configured');
    // OS item service expects raw merchant ID without .myshopify.com suffix
    const storeId = domain.replace(/\.myshopify\.com$/i, '');
    const url = `${base}/api/v1/admin/products/${encodeURIComponent(productId)}?storeId=${encodeURIComponent(storeId)}&show_variants=true`;
    const res = await fetch(url, {
      headers: { 'gk-merchant-id': merchantId, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      this.logger.error({ merchantId, productId, status: res.status }, 'OS item service error');
    }
    return res.json();
  }

  // ── Refunds (GoKwik OS Order Service) ────────────────────────────────────

  async calculateRefund(merchantId: string, orderId: string, body: unknown): Promise<unknown> {
    return this.osOrderPost(
      merchantId,
      '/api/v1/admin/refunds/calculate',
      { ...(body as Record<string, unknown>), order_id: orderId },
    );
  }

  async createRefund(merchantId: string, orderId: string, body: unknown): Promise<unknown> {
    return this.osOrderPost(
      merchantId,
      '/api/v1/admin/refunds',
      { ...(body as Record<string, unknown>), order_id: orderId },
    );
  }

  async getRefunds(merchantId: string, orderId: string): Promise<unknown> {
    const base = this.config.get('OS_ORDER_BASE_URL', { infer: true }) as string;
    if (!base) throw new Error('OS_ORDER_BASE_URL is not configured');
    const url = `${base}/api/v1/admin/orders/${encodeURIComponent(orderId)}/refunds`;
    const res = await fetch(url, {
      headers: { 'gk-merchant-id': merchantId, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      this.logger.error({ merchantId, orderId, status: res.status }, 'OS order service error');
    }
    return res.json();
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
      this.logger.error({ merchantId, path, status: res.status }, 'OS order service error');
    }
    return res.json();
  }
}
