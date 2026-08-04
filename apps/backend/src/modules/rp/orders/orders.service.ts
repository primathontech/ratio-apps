import { Injectable } from '@nestjs/common';
import { RpRatioClientService } from '../ratio-client/ratio-client.service';
import { RpRatioTokenProvider } from '../oauth/ratio-token.provider';
import { RpTransformerService } from '../transformer/transformer.service';
import { RpIdMappingService } from '../id-mapping/id-mapping.service';
import { normalizeOrder } from './normalize-order';

@Injectable()
export class RpOrdersService {
  constructor(
    private readonly ratioClient: RpRatioClientService,
    private readonly tokenProvider: RpRatioTokenProvider,
    private readonly transformer: RpTransformerService,
    private readonly idMapping: RpIdMappingService,
  ) {}

  /**
   * Create an order via Ratio (used by RP's exchange-order flow, which POSTs a Shopify
   * REST order body). Maps to Ratio's CreateOrderDto, then normalizes the response back
   * into the Shopify REST order shape RP persists.
   */
  async createOrder(merchantId: string, body: unknown): Promise<unknown> {
    const dto = this.transformer.mapCreateOrder(body as Record<string, unknown>);
    const raw = (await this.tokenProvider.withAuthRetry(merchantId, (token) =>
      this.ratioClient.createOrder(token, merchantId, dto),
    )) as Record<string, unknown>;
    const envelope = raw as Record<string, Record<string, unknown>>;
    const order = (envelope.data?.order ?? envelope.order ?? raw) as Record<string, unknown>;
    return { order: normalizeOrder(order) };
  }

  async getOrders(merchantId: string, params: Record<string, string>): Promise<unknown> {
    const raw = await this.tokenProvider.withAuthRetry(merchantId, (token) =>
      this.ratioClient.getOrders(token, params),
    ) as Record<string, unknown>;
    // Normalize orders list — same as single-order normalization so RP's Mongoose Number
    // fields and id comparisons work without any OS-awareness in the RP codebase.
    const orders = Array.isArray(raw.orders)
      ? raw.orders.map((o) => normalizeOrder(o as Record<string, unknown>))
      : raw.orders;
    // Persist id mappings fire-and-forget — don't block the response. Run sequentially
    // (not Promise.all) to avoid exhausting the MySQL connection pool: an orders list
    // can have many orders × many line items × 2 writes each, which fans out to dozens
    // of concurrent DB connections and hits mysql2's queueLimit ("Queue limit reached").
    if (Array.isArray(orders)) {
      void this.persistLineItemIdMappingsSequential(orders as Record<string, unknown>[]);
    }
    return { ...raw, orders };
  }

  async getOrder(merchantId: string, orderId: string): Promise<unknown> {
    const raw = await this.tokenProvider.withAuthRetry(merchantId, (token) =>
      this.ratioClient.getOrder(token, orderId),
    ) as Record<string, unknown>;
    // Fall back through legacy { data: { order } } and bare-order shapes for safety.
    const envelope = raw as Record<string, Record<string, unknown>>;
    const order = (envelope.data?.order ?? (raw as Record<string, unknown>).order ?? raw) as Record<string, unknown>;
    const normalized = normalizeOrder(order);
    // Fire-and-forget, sequential — same rationale as getOrders.
    void this.persistLineItemIdMappingsSequential([normalized]);
    return { order: normalized };
  }

  async patchOrder(merchantId: string, orderId: string, body: unknown): Promise<unknown> {
    const raw = await this.tokenProvider.withAuthRetry(merchantId, (token) =>
      this.ratioClient.patchOrder(token, merchantId, orderId, body),
    ) as Record<string, unknown>;
    return { order: raw.order ?? raw };
  }

  /**
   * Ratio's orders have no Shopify-style Transactions API — orders never populate a real
   * `transactions` array. Synthesize a single Shopify-shaped transaction from the
   * order's own financial_status/payment_details instead, since that's what RP's
   * COD-detection (checkOrderIsCode) actually keys off of. financial_status 'pending'
   * means uncaptured/COD, matching Shopify's "no transaction yet" semantics.
   */
  async getTransactions(merchantId: string, orderId: string): Promise<unknown> {
    const raw = await this.tokenProvider.withAuthRetry(merchantId, (token) =>
      this.ratioClient.getOrder(token, orderId),
    ) as Record<string, unknown>;
    const envelope = raw as Record<string, Record<string, unknown>>;
    const order = (envelope.data?.order ?? (raw as Record<string, unknown>).order ?? raw) as Record<string, unknown>;

    if (Array.isArray(order.transactions) && order.transactions.length > 0) {
      return { transactions: order.transactions };
    }
    if (!order || order.financial_status === 'pending') {
      return { transactions: [] };
    }
    const paymentDetails = (order.payment_details ?? {}) as Record<string, unknown>;
    const paymentGatewayNames = Array.isArray(order.payment_gateway_names) ? order.payment_gateway_names : [];
    return {
      transactions: [{
        kind: 'sale',
        status: 'success',
        authorization: paymentDetails.paymentId ?? paymentDetails.pgPaymentTrnxId ?? 'os-payment',
        receipt: {},
        gateway: paymentDetails.paymentInstrument ?? paymentGatewayNames[0] ?? 'gokwik',
      }],
    };
  }

  /**
   * Persists (hashed → real OS id) mappings for a list of normalized orders, one write at
   * a time. Sequential (not Promise.all) to avoid exhausting the MySQL connection pool:
   * many orders × many line items × 2 writes each fans out to dozens of concurrent DB
   * connections and hits mysql2's queueLimit ("Queue limit reached"). Callers invoke this
   * fire-and-forget (void) so sequential execution never blocks the HTTP response.
   */
  private async persistLineItemIdMappingsSequential(orders: Record<string, unknown>[]): Promise<void> {
    for (const order of orders) {
      const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
      for (const li of lineItems) {
        const item = li as Record<string, unknown>;
        if (item.os_product_id != null) {
          await this.idMapping.hashAndPersist('product', String(item.os_product_id));
        }
        if (item.os_variant_id != null) {
          await this.idMapping.hashAndPersist('variant', String(item.os_variant_id));
        }
      }
    }
  }
}
