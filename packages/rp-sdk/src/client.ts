import type { RpConfig, RpExchangeProduct, RpLineItem, RpOrder, RpReason } from './types';

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

async function post<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    status: boolean;
    messageCode?: string;
    data: T;
    message?: string;
  };
  if (!json.status) {
    throw new Error(json.message ?? json.messageCode ?? 'Request failed');
  }
  return json.data;
}

export async function createSession(
  config: RpConfig,
  order: string,
  identifier: string,
): Promise<string> {
  const token = await post<string>(`${config.apiUrl}/customer/v1/session`, {
    store: config.store,
    order,
    identifier,
  });
  return token;
}

export async function findOrder(
  config: RpConfig,
  session: string,
): Promise<{ order: RpOrder; lineItems: RpLineItem[]; currency: string }> {
  const data = await post<{
    order: RpOrder;
    orders: RpLineItem[];
    currency: string;
  }>(`${config.apiUrl}/customer/v1/find-order`, { session });

  return {
    order: data.order,
    lineItems: (data.orders ?? []).filter((li) => li.returnable),
    currency: data.currency ?? 'INR',
  };
}

export async function getReasons(
  config: RpConfig,
  session: string,
  orderId: number,
  lineItemIds: number[],
): Promise<RpReason[]> {
  try {
    const data = await post<{
      order: unknown;
      line_items: Array<{ id: number; reasons?: RpReason[] }>;
    }>(`${config.apiUrl}/customer/v1/reasons`, {
      session,
      order: orderId,
      line_items: lineItemIds,
      type: 'return',
    });
    const all = (data.line_items ?? []).flatMap((li) => li.reasons ?? []);
    const seen = new Set<string>();
    return all.filter((r) => !seen.has(r._id) && !!seen.add(r._id));
  } catch {
    return [];
  }
}

/**
 * Fetch exchange-eligible products for an item (RP's exchange picker). RP filters by
 * the store's exchange rule + a price cap relative to the returned item — for OS stores
 * this is same-or-lower price (they can't collect a difference).
 */
export async function searchExchangeProducts(
  config: RpConfig,
  session: string,
  originalProductId: number,
  cappedPrice: number,
  page = 1,
  limit = 30,
): Promise<RpExchangeProduct[]> {
  const qs = new URLSearchParams({
    session,
    original_product_id: String(originalProductId),
    capped_price: String(cappedPrice),
    page: String(page),
    limit: String(limit),
  }).toString();
  try {
    const data = await post<{ docs?: RpExchangeProduct[]; products?: RpExchangeProduct[] }>(
      `${config.apiUrl}/customer/v1/products?${qs}`,
      {},
    );
    return data.docs ?? data.products ?? [];
  } catch {
    return [];
  }
}

export interface CreateRequestItem {
  id: number;
  quantity: number;
  reasonId: string;
  reasonText: string;
  comment: string;
  type: 'return' | 'exchange';
  refundMode: string;
  originalProductId?: number | undefined;
  originalVariantId?: number | undefined;
  exchangeProductId?: number | undefined;
  exchangeVariantId?: number | undefined;
}

export async function createRequest(
  config: RpConfig,
  session: string,
  orderId: number,
  items: CreateRequestItem[],
): Promise<{ serialNumber: string }> {
  const results = await post<Array<{ serial_number: string }>>(
    `${config.apiUrl}/return-exchange/v1/create`,
    {
      session,
      order: orderId,
      client_details: { source: 'rp-sdk' },
      channel: config.channel ?? 1,
      line_items: items.map((item) =>
        item.type === 'exchange'
          ? {
              id: item.id,
              quantity: item.quantity,
              reason: item.reasonId,
              reason_text: item.reasonText,
              comment: item.comment || undefined,
              type: 'exchange',
              original_product_id: item.originalProductId,
              original_variant_id: item.originalVariantId,
              exchange_product_id: item.exchangeProductId,
              exchange_variant_id: item.exchangeVariantId,
            }
          : {
              id: item.id,
              quantity: item.quantity,
              reason: item.reasonId,
              reason_text: item.reasonText,
              comment: item.comment || undefined,
              type: 'return',
              requested_refund_mode: item.refundMode,
            },
      ),
    },
    { 'idempotency-key': uid() },
  );
  const first = results[0];
  return { serialNumber: first?.serial_number ?? '' };
}
