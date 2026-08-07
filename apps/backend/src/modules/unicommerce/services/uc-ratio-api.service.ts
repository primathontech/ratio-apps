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
    // The whole paging loop runs inside ONE withAuthRetry so a mid-loop 401 (token
    // invalidated server-side by another environment before our own recorded expiry)
    // forces exactly one refresh and retries the loop from `opts.offset` with the new
    // token — re-running from the start is safe because each page is a stateless
    // offset-based GET, and the accumulated `items` are reset so nothing duplicates.
    return this.tokens.withAuthRetry(merchantId, async (accessToken) => {
      const items: Rec[] = [];
      let offset = opts.offset;
      const end = opts.offset + opts.limit;
      while (offset < end) {
        const take = Math.min(this.requestCap, end - offset);
        const env = await this.ratio.request(
          // NOT a typo — Ratio's gateway genuinely routes the Products
          // resource at double-`v1`; a single `/api/v1/products` 404s
          // ("Cannot GET /api/v1/products"), confirmed live. Every other
          // connector module that calls this same resource (google's
          // ratio-products.service.ts, wizzy's ratio-products.service.ts,
          // meta's catalog-source.service.ts) uses this identical path —
          // do not "fix" this to match the Orders API's single-`v1` shape.
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
    });
  }

  async updateVariantInventory(merchantId: string, variantId: string, quantity: number): Promise<void> {
    await this.tokens.withAuthRetry(merchantId, (accessToken) =>
      // Reverted to double-v1 to match the confirmed-correct Products path
      // above (same resource family) — NOT independently verified against the
      // live API the way /api/v1/v1/products was, since no other connector
      // module calls a variants endpoint directly to compare against. Restored
      // to its original, prior-working state rather than leave an unverified
      // guess in place.
      this.ratio.request(`/api/v1/v1/variants/${encodeURIComponent(variantId)}`, looseSchema, {
        accessToken,
        method: 'PUT',
        body: { inventory: { quantity } },
      }),
    );
  }

  async listOrders(merchantId: string, opts: {
    page: number;
    pageSize: number;
    orderStatus?: string;
    orderDateFrom?: string;
    orderDateTo?: string;
  }): Promise<Rec[]> {
    return this.tokens.withAuthRetry(merchantId, async (accessToken) => {
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
    });
  }

  async getOrder(merchantId: string, orderId: string): Promise<Rec | null> {
    return this.tokens.withAuthRetry(merchantId, async (accessToken) => {
      const env = await this.ratio.request(
        `/api/v1/orders/${encodeURIComponent(orderId)}`,
        envelopeSchema,
        { accessToken },
      );
      if (!env || typeof env !== 'object' || Array.isArray(env)) return null;
      const o = env as Rec;
      const order = o.order ?? o.data ?? o;
      return order && typeof order === 'object' ? (order as Rec) : null;
    });
  }

  async updateOrderFulfillment(
    merchantId: string,
    ratioOrderId: string,
    patch: {
      fulfillment_status: string;
      metafields: Array<{ namespace: string; key: string; value: string; type: string }>;
    },
  ): Promise<void> {
    await this.tokens.withAuthRetry(merchantId, (accessToken) =>
      this.ratio.request(
        `/api/v1/orders/${encodeURIComponent(ratioOrderId)}`,
        looseSchema,
        { accessToken, method: 'PATCH', body: patch },
      ),
    );
  }

  async updateOrderStatus(merchantId: string, ratioOrderId: string, status: string): Promise<void> {
    await this.tokens.withAuthRetry(merchantId, (accessToken) =>
      this.ratio.request(
        `/api/v1/orders/${encodeURIComponent(ratioOrderId)}`,
        looseSchema,
        { accessToken, method: 'PATCH', body: { fulfillment_status: status } },
      ),
    );
  }

  async cancelOrder(merchantId: string, ratioOrderId: string): Promise<void> {
    await this.tokens.withAuthRetry(merchantId, (accessToken) =>
      this.ratio.request(
        `/api/v1/orders/${encodeURIComponent(ratioOrderId)}/cancel`,
        looseSchema,
        { accessToken, method: 'PATCH' },
      ),
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
    await this.tokens.withAuthRetry(merchantId, (accessToken) =>
      this.ratio.request(
        `/api/v1/orders/${encodeURIComponent(ratioOrderId)}`,
        looseSchema,
        { accessToken, method: 'PATCH', body: { line_items: lineItems } },
      ),
    );
  }
}
