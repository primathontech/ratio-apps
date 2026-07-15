import { Injectable } from '@nestjs/common';
import { RpRatioClientService } from '../ratio-client/ratio-client.service';
import { RpTransformerService } from '../transformer/transformer.service';
import { normalizeOrder } from './normalize-order';

@Injectable()
export class RpOrdersService {
  constructor(
    private readonly ratioClient: RpRatioClientService,
    private readonly transformer: RpTransformerService,
  ) {}

  /**
   * Create an order in OS (used by RP's exchange-order flow, which POSTs a Shopify
   * REST order body). Maps to the OS CreateOrderDto, then normalizes the OS response
   * back into the Shopify REST order shape RP persists.
   */
  async createOrder(merchantId: string, body: unknown): Promise<unknown> {
    const dto = this.transformer.mapCreateOrder(body as Record<string, unknown>);
    const raw = (await this.ratioClient.createOrder(merchantId, dto)) as Record<string, unknown>;
    const envelope = raw as Record<string, Record<string, unknown>>;
    const order = (envelope.data?.order ?? envelope.order ?? raw) as Record<string, unknown>;
    // RP's ShopifyAxios.createOrder returns the bare order object (result.data.order).
    return { order: normalizeOrder(order) };
  }

  async getOrders(merchantId: string, params: Record<string, string>): Promise<unknown> {
    const raw = await this.ratioClient.getOrders(merchantId, params) as Record<string, unknown>;
    // Normalize orders list — same as single-order normalization so RP's Mongoose Number
    // fields and id comparisons work without any OS-awareness in the RP codebase.
    const orders = Array.isArray(raw.orders) ? raw.orders.map((o) => normalizeOrder(o as Record<string, unknown>)) : raw.orders;
    return { ...raw, orders };
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

  /**
   * OS has no Shopify-style Transactions API — its orders never populate a real
   * `transactions` array. Synthesize a single Shopify-shaped transaction from the
   * order's own financial_status/payment_details instead, since that's what RP's
   * COD-detection (checkOrderIsCode) actually keys off of. financial_status 'pending'
   * means uncaptured/COD, matching Shopify's "no transaction yet" semantics.
   */
  async getTransactions(merchantId: string, orderId: string): Promise<unknown> {
    const raw = await this.ratioClient.getOrder(merchantId, orderId) as Record<string, unknown>;
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
}
