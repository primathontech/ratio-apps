import { Injectable, Logger } from '@nestjs/common';

export interface RatioOrder {
  id: string;
  order_number: string;
  name: string;
  email: string;
  phone: string;
  currency: string;
  created_at: string;
  financial_status: string;
  fulfillment_status: string | null;
  payment_method: string;
  customer: Record<string, unknown>;
  shipping_address: Record<string, unknown>;
  billing_address: Record<string, unknown>;
  line_items: RatioLineItem[];
  total_price: string;
  tags: string;
}

export interface RatioLineItem {
  id: number;
  variant_id: number;
  product_id: number;
  title: string;
  sku: string;
  price: string;
  quantity: number;
  discount: string;
}

export interface RatioOrderUpdate {
  status?: string;
  tracking_number?: string;
  logistics_partner?: string;
  awb_number?: string;
  edd?: string;
  uc_order_code?: string;
}

export interface RatioOrderSearchParams {
  name?: string;
  search?: string;
  financial_status?: string;
  fulfillment_status?: string;
  limit?: string;
  page?: string;
}

export interface RatioOrderSearchResult {
  orders: RatioOrder[];
  total: number;
}

@Injectable()
export class MockRatioOrderService {
  private readonly logger = new Logger(MockRatioOrderService.name);
  private readonly orders = new Map<string, RatioOrder>();
  private nextId = 1000;

  constructor() {
    this.seedOrders();
  }

  private seedOrders(): void {
    this.addOrder({
      id: 'ordr_mock_001',
      order_number: '1001',
      name: '#1001',
      email: 'customer@example.com',
      phone: '+919999999999',
      currency: 'INR',
      created_at: new Date().toISOString(),
      financial_status: 'paid',
      fulfillment_status: null,
      payment_method: 'cod',
      customer: { id: 1, first_name: 'Raj', last_name: 'Kumar', email: 'customer@example.com' },
      shipping_address: {
        address1: '42, MG Road',
        city: 'Mumbai',
        state: 'Maharashtra',
        zip: '400001',
        country: 'IN',
        phone: '+919999999999',
      },
      billing_address: {
        address1: '42, MG Road',
        city: 'Mumbai',
        state: 'Maharashtra',
        zip: '400001',
        country: 'IN',
        phone: '+919999999999',
      },
      line_items: [
        { id: 1, variant_id: 101, product_id: 1001, title: 'Whey Protein 1kg', sku: 'RAT-WHEY-1KG', price: '2499.00', quantity: 1, discount: '0.00' },
        { id: 2, variant_id: 102, product_id: 1001, title: 'Whey Protein 2kg', sku: 'RAT-WHEY-2KG', price: '4499.00', quantity: 2, discount: '200.00' },
      ],
      total_price: '6998.00',
      tags: '',
    });
  }

  private addOrder(data: RatioOrder): void {
    this.orders.set(data.id, data);
  }

  createOrderFromWebhook(payload: Record<string, unknown>): RatioOrder {
    const orderData = (payload?.order ?? payload) as Record<string, unknown> | undefined;
    const id = `ordr_mock_${++this.nextId}`;
    const orderNumber = String(this.nextId);
    const lineItems = Array.isArray(orderData?.line_items)
      ? (orderData.line_items as Record<string, unknown>[]).map((li, i) => ({
          id: i + 1,
          variant_id: Number(li.variant_id ?? 0),
          product_id: Number(li.product_id ?? 0),
          title: String(li.title ?? ''),
          sku: String(li.sku ?? ''),
          price: String(li.price ?? '0'),
          quantity: Number(li.quantity ?? 1),
          discount: String(li.discount ?? '0'),
        }))
      : [];

    const order: RatioOrder = {
      id,
      order_number: orderNumber,
      name: `#${orderNumber}`,
      email: String(orderData?.email ?? ''),
      phone: String(orderData?.phone ?? ''),
      currency: 'INR',
      created_at: new Date().toISOString(),
      financial_status: 'paid',
      fulfillment_status: null,
      payment_method: String(orderData?.payment_method ?? 'cod'),
      customer: (orderData?.customer as Record<string, unknown>) ?? {},
      shipping_address: (orderData?.shipping_address as Record<string, unknown>) ?? {},
      billing_address: (orderData?.billing_address as Record<string, unknown>) ?? {},
      line_items: lineItems,
      total_price: String(orderData?.total_price ?? '0'),
      tags: String(orderData?.tags ?? ''),
    };

    this.orders.set(id, order);
    this.logger.log({ msg: 'mock order created from webhook', orderId: id });
    return order;
  }

  async getOrder(orderId: string): Promise<RatioOrder | null> {
    return this.orders.get(orderId) ?? null;
  }

  async searchOrders(params: RatioOrderSearchParams): Promise<RatioOrderSearchResult> {
    let results = Array.from(this.orders.values());
    if (params.search) {
      results = results.filter((o) => o.name.includes(params.search!) || o.order_number.includes(params.search!));
    }
    if (params.name) {
      results = results.filter((o) => o.name === params.name || o.order_number === params.name);
    }
    return { orders: results.slice(0, Number(params.limit ?? 50)), total: results.length };
  }

  async updateOrder(orderId: string, update: RatioOrderUpdate): Promise<RatioOrder | null> {
    const order = this.orders.get(orderId);
    if (!order) return null;
    if (update.status) order.fulfillment_status = update.status;
    if (update.tracking_number) (order as any).tracking_number = update.tracking_number;
    if (update.logistics_partner) (order as any).logistics_partner = update.logistics_partner;
    if (update.awb_number) (order as any).awb_number = update.awb_number;
    if (update.uc_order_code) (order as any).uc_order_code = update.uc_order_code;
    this.logger.log({ msg: 'mock order updated', orderId, update });
    return order;
  }

  async getTopSkus(_merchantId: string, limit = 20): Promise<string[]> {
    const allSkus = new Set<string>();
    for (const order of this.orders.values()) {
      for (const item of order.line_items) {
        allSkus.add(item.sku);
      }
    }
    return Array.from(allSkus).slice(0, limit);
  }
}
