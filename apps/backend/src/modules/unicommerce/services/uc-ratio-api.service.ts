import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { RatioClient } from '../../../core/ratio-client/ratio.client';
import { UC_RATIO } from '../tokens';
import { UcRatioTokenProvider } from '../oauth/ratio-token.provider';

type Rec = Record<string, unknown>;

const envelopeSchema = z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]);
const looseSchema = z.unknown();

function asArray(v: unknown): Rec[] | null {
  return Array.isArray(v) ? (v as Rec[]) : null;
}

function extractItems(env: unknown): Rec[] {
  if (Array.isArray(env)) return env as Rec[];
  if (!env || typeof env !== 'object') return [];
  const o = env as Rec;
  const data = o.data;
  const nested = data && typeof data === 'object' ? (data as Rec) : null;
  return (
    asArray(data) ??
    asArray(o.products) ??
    asArray(o.orders) ??
    asArray(o.items) ??
    asArray(o.results) ??
    (nested
      ? (asArray(nested.products) ??
        asArray(nested.orders) ??
        asArray(nested.items) ??
        asArray(nested.data) ??
        asArray(nested.results))
      : null) ??
    []
  );
}

@Injectable()
export class UcRatioApiService {
  constructor(
    private readonly tokens: UcRatioTokenProvider,
    @Inject(UC_RATIO) private readonly ratio: RatioClient,
  ) {}

  private readonly requestCap = 10;

  async listProducts(merchantId: string, opts: { offset: number; limit: number }): Promise<Rec[]> {
    const accessToken = await this.tokens.getAccessToken(merchantId);
    const items: Rec[] = [];
    let offset = opts.offset;
    const end = opts.offset + opts.limit;
    while (offset < end) {
      const take = Math.min(this.requestCap, end - offset);
      const env = await this.ratio.request(
        `/api/v1/v1/products?offset=${offset}&limit=${take}&show_variants=true&status=active`,
        envelopeSchema,
        { accessToken },
      );
      const page = extractItems(env);
      items.push(...page);
      if (page.length < take) break;
      offset += take;
    }
    return items;
  }

  async updateVariantInventory(merchantId: string, variantId: string, quantity: number): Promise<void> {
    const accessToken = await this.tokens.getAccessToken(merchantId);
    await this.ratio.request(`/api/v1/v1/variants/${encodeURIComponent(variantId)}`, looseSchema, {
      accessToken,
      method: 'PUT',
      body: { inventory: { quantity } },
    });
  }

  async listOrders(merchantId: string, opts: {
    page: number;
    pageSize: number;
    orderStatus?: string;
    orderDateFrom?: string;
    orderDateTo?: string;
  }): Promise<Rec[]> {
    const accessToken = await this.tokens.getAccessToken(merchantId);
    let path = `/api/v1/orders?page=${opts.page}&limit=${opts.pageSize}`;
    // TRD §2.3, confirmed bug fix: Ratio's Orders API has no `orderStatus`
    // filter of its own — forwarding UC's value verbatim was silently
    // ignored, dumping every order unfiltered. UC's only real value here is
    // `CREATED`, which maps to Ratio's own status=open&fulfillment_status=unfulfilled.
    if (opts.orderStatus === 'CREATED') {
      path += '&status=open&fulfillment_status=unfulfilled';
    }
    const env = await this.ratio.request(path, envelopeSchema, { accessToken });
    const items = extractItems(env);

    // Ratio's Orders API has no date-range query param at all — filter
    // client-side on whatever the (date-unfiltered) request returned.
    if (!opts.orderDateFrom && !opts.orderDateTo) return items;
    const from = opts.orderDateFrom ? new Date(opts.orderDateFrom).getTime() : Number.NEGATIVE_INFINITY;
    const to = opts.orderDateTo ? new Date(opts.orderDateTo).getTime() : Number.POSITIVE_INFINITY;
    return items.filter((item) => {
      const createdAt = item.created_at;
      if (typeof createdAt !== 'string') return true;
      const t = new Date(createdAt).getTime();
      return t >= from && t <= to;
    });
  }

  async getOrder(merchantId: string, orderId: string): Promise<Rec | null> {
    const accessToken = await this.tokens.getAccessToken(merchantId);
    const env = await this.ratio.request(
      `/api/v1/orders/${encodeURIComponent(orderId)}`,
      envelopeSchema,
      { accessToken },
    );
    if (!env || typeof env !== 'object' || Array.isArray(env)) return null;
    const o = env as Rec;
    const order = o.order ?? o.data ?? o;
    return order && typeof order === 'object' ? (order as Rec) : null;
  }

  async updateOrderFulfillment(
    merchantId: string,
    ratioOrderId: string,
    patch: {
      fulfillment_status: string;
      metafields: Array<{ namespace: string; key: string; value: string; type: string }>;
    },
  ): Promise<void> {
    const accessToken = await this.tokens.getAccessToken(merchantId);
    await this.ratio.request(
      `/api/v1/orders/${encodeURIComponent(ratioOrderId)}`,
      looseSchema,
      { accessToken, method: 'PATCH', body: patch },
    );
  }

  async updateOrderStatus(merchantId: string, ratioOrderId: string, status: string): Promise<void> {
    const accessToken = await this.tokens.getAccessToken(merchantId);
    await this.ratio.request(
      `/api/v1/orders/${encodeURIComponent(ratioOrderId)}`,
      looseSchema,
      { accessToken, method: 'PATCH', body: { fulfillment_status: status } },
    );
  }

  async cancelOrder(merchantId: string, ratioOrderId: string): Promise<void> {
    const accessToken = await this.tokens.getAccessToken(merchantId);
    await this.ratio.request(
      `/api/v1/orders/${encodeURIComponent(ratioOrderId)}/cancel`,
      looseSchema,
      { accessToken, method: 'PATCH' },
    );
  }

  // TRD §2.7 — a partial cancel (some of an order's items, not all) has no
  // item-level granularity on the whole-order-cancel endpoint above; it
  // must PATCH the order directly with a line_items[] array reflecting only
  // the surviving (non-cancelled) items.
  async updateOrderLineItems(
    merchantId: string,
    ratioOrderId: string,
    lineItems: { id: string }[],
  ): Promise<void> {
    const accessToken = await this.tokens.getAccessToken(merchantId);
    await this.ratio.request(
      `/api/v1/orders/${encodeURIComponent(ratioOrderId)}`,
      looseSchema,
      { accessToken, method: 'PATCH', body: { line_items: lineItems } },
    );
  }
}
