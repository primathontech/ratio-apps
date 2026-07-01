import { Injectable } from '@nestjs/common';
import { RpRatioClientService } from '../ratio-client/ratio-client.service';

// Converts a UUID or arbitrary string to a deterministic numeric string
// by parsing the first 15 hex digits as base-16. Matches transformer.service.ts logic.
function numericIdFromString(value: string): number {
  if (!value) return 0;
  // If already numeric (e.g. "3760"), parse directly
  const direct = Number(value);
  if (!isNaN(direct) && direct > 0) return direct;
  // UUID / arbitrary string — take first 15 hex chars
  const hex = value.replace(/-/g, '').replace(/[^0-9a-f]/gi, '').slice(0, 15);
  return hex ? parseInt(hex, 16) : 0;
}

// Adds Shopify-compatible price_set / discounted_price_set fields that RP BE
// expects but that the OS order service doesn't include.
// Converts all IDs to numbers so RP Mongoose Number fields and comparisons work
// without any OS-awareness in the RP codebase.
function normalizeOrder(order: Record<string, unknown>): Record<string, unknown> {
  const currency = (order.currency as string) || 'INR';

  const moneySet = (amount: string | number | unknown) => ({
    presentment_money: { amount: String(amount), currency_code: currency },
    shop_money: { amount: String(amount), currency_code: currency },
  });

  // Normalize tax_lines on each line item
  const lineItems = Array.isArray(order.line_items)
    ? order.line_items.map((li: Record<string, unknown>) => {
        const taxLines = Array.isArray(li.tax_lines)
          ? li.tax_lines.map((tl: Record<string, unknown>) => ({
              ...tl,
              price_set: tl.price_set ?? moneySet(tl.price ?? 0),
            }))
          : [];
        const discountAllocations = Array.isArray(li.discount_allocations)
          ? li.discount_allocations.map((da: Record<string, unknown>) => ({
              ...da,
              amount_set: da.amount_set ?? moneySet(da.amount ?? 0),
            }))
          : [];
        // Shopify uses snake_case currency_code; OS uses camelCase currencyCode
        const priceSet = li.price_set as Record<string, unknown> | undefined;
        const normalizedPriceSet = priceSet
          ? {
              presentment_money: {
                ...(priceSet.presentment_money as object),
                currency_code:
                  (priceSet.presentment_money as Record<string, unknown>)?.currency_code ??
                  (priceSet.presentment_money as Record<string, unknown>)?.currencyCode ??
                  currency,
              },
              shop_money: {
                ...(priceSet.shop_money as object),
                currency_code:
                  (priceSet.shop_money as Record<string, unknown>)?.currency_code ??
                  (priceSet.shop_money as Record<string, unknown>)?.currencyCode ??
                  currency,
              },
            }
          : moneySet(li.price ?? 0);
        return {
          ...li,
          // Convert string/UUID IDs to numbers — Shopify always returns numeric IDs
          id: numericIdFromString(String(li.id ?? '')),
          variant_id: li.variant_id != null ? numericIdFromString(String(li.variant_id)) : null,
          product_id: li.product_id != null ? numericIdFromString(String(li.product_id)) : null,
          price_set: normalizedPriceSet,
          tax_lines: taxLines,
          discount_allocations: discountAllocations,
        };
      })
    : [];

  // Normalize shipping_lines
  const shippingLines = Array.isArray(order.shipping_lines)
    ? order.shipping_lines.map((sl: Record<string, unknown>) => ({
        ...sl,
        price_set: sl.price_set ?? moneySet(sl.price ?? 0),
        discounted_price_set: sl.discounted_price_set ?? moneySet(sl.discounted_price ?? sl.price ?? 0),
      }))
    : [];

  // Normalize the GoKwik order ID: "ordr_1782463276915557" → 1782463276915557
  const rawId = String(order.id ?? '');
  const numericOrderId = rawId.match(/^ordr_(\d+)$/i)
    ? Number(rawId.replace(/^ordr_/i, ''))
    : numericIdFromString(rawId);

  // Normalize customer ID — OS uses UUID, Shopify uses numeric
  const customer = order.customer as Record<string, unknown> | null | undefined;
  const normalizedCustomer = customer
    ? { ...customer, id: numericIdFromString(String(customer.id ?? '')) }
    : customer;

  return {
    ...order,
    id: numericOrderId,
    os_order_id: rawId,
    customer: normalizedCustomer,
    line_items: lineItems,
    shipping_lines: shippingLines,
  };
}

@Injectable()
export class RpOrdersService {
  constructor(private readonly ratioClient: RpRatioClientService) {}

  async getOrders(merchantId: string, params: Record<string, string>): Promise<unknown> {
    const raw = await this.ratioClient.getOrders(merchantId, params) as Record<string, unknown>;
    return raw;
  }

  async getOrder(merchantId: string, orderId: string): Promise<unknown> {
    const raw = await this.ratioClient.getOrder(merchantId, orderId) as Record<string, unknown>;
    // OS wraps responses as { status_code, data: { order: {...} } }; fall back through
    // legacy { order: {...} } and bare-order shapes for safety.
    const envelope = raw as Record<string, Record<string, unknown>>;
    const order = (envelope.data?.order ?? (raw as Record<string, unknown>).order ?? raw) as Record<string, unknown>;
    return { order: normalizeOrder(order) };
  }

  async patchOrder(merchantId: string, orderId: string, body: unknown): Promise<unknown> {
    const raw = await this.ratioClient.patchOrder(merchantId, orderId, body) as Record<string, unknown>;
    return { order: raw.order ?? raw };
  }

  async getTransactions(merchantId: string, orderId: string): Promise<unknown> {
    const raw = await this.ratioClient.getOrder(merchantId, orderId) as Record<string, unknown>;
    const envelope = raw as Record<string, Record<string, unknown>>;
    const order = (envelope.data?.order ?? (raw as Record<string, unknown>).order ?? raw) as Record<string, unknown>;
    const transactions = Array.isArray(order.transactions) ? order.transactions : [];
    return { transactions };
  }
}
