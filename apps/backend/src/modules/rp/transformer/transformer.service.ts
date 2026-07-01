import { Injectable } from '@nestjs/common';

type Rec = Record<string, unknown>;

@Injectable()
export class RpTransformerService {
  /**
   * Deterministic UUID → numeric-string ID.
   * Takes the first 15 hex chars of the UUID (stripped of dashes) and parses as
   * a base-16 number. Stable across calls for the same UUID input.
   */
  numericId(uuid: string): string {
    const hex = uuid.replace(/-/g, '').slice(0, 15);
    return parseInt(hex, 16).toString();
  }

  /** 89900 (paise) → "899.00" (rupees string) */
  paiseToRupees(paise: number | null | undefined): string {
    if (paise == null) return '0.00';
    return (paise / 100).toFixed(2);
  }

  /** "899.00" (rupees string) → 89900 (paise) */
  rupeesToPaise(rupees: string | number | null | undefined): number {
    if (rupees == null) return 0;
    return Math.round(parseFloat(String(rupees)) * 100);
  }

  isoDate(d: Date | string | null | undefined): string | null {
    if (!d) return null;
    return new Date(d).toISOString();
  }

  // ── Order transformation ──────────────────────────────────────────────────

  shopifyOrder(ratioOrder: Rec): Rec {
    const id = this.numericId(String(ratioOrder.id ?? ''));
    const lineItems = this.shopifyLineItems(ratioOrder);

    return {
      id,
      admin_graphql_api_id: `gid://shopify/Order/${id}`,
      order_number: ratioOrder.orderNumber ?? ratioOrder.order_number,
      name: `#${ratioOrder.orderNumber ?? ratioOrder.order_number}`,
      created_at: this.isoDate((ratioOrder.createdAt ?? ratioOrder.created_at) as string),
      updated_at: this.isoDate((ratioOrder.updatedAt ?? ratioOrder.updated_at) as string),
      total_price: this.paiseToRupees(ratioOrder.totalAmount as number),
      subtotal_price: this.paiseToRupees(ratioOrder.totalAmount as number),
      currency: 'INR',
      financial_status: this.mapFinancialStatus(String(ratioOrder.status ?? '')),
      customer: this.shopifyCustomerEmbed(ratioOrder.customer as Rec | null),
      line_items: lineItems,
      shipping_address: this.snakeAddress(ratioOrder.shippingAddress as Rec | null),
      billing_address: this.snakeAddress(ratioOrder.billingAddress as Rec | null),
    };
  }

  private shopifyLineItems(ratioOrder: Rec): Rec[] {
    const items = Array.isArray(ratioOrder.lineItems) ? (ratioOrder.lineItems as Rec[]) : [];
    return items.map((item) => ({
      id: this.numericId(String(item.id ?? '')),
      product_id: this.numericId(String(item.productId ?? item.product_id ?? '')),
      variant_id: this.numericId(String(item.variantId ?? item.variant_id ?? '')),
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      price: this.paiseToRupees(item.price as number),
      location_id: item.locationId
        ? this.numericId(String(item.locationId))
        : item.location_id
          ? this.numericId(String(item.location_id))
          : null,
    }));
  }

  private mapFinancialStatus(status: string): string {
    const s = status.toLowerCase();
    if (s === 'refunded') return 'refunded';
    if (s === 'partial' || s === 'partially_refunded') return 'partially_refunded';
    if (s === 'paid') return 'paid';
    return s;
  }

  private shopifyCustomerEmbed(c: Rec | null): Rec | null {
    if (!c) return null;
    return {
      id: this.numericId(String(c.id ?? '')),
      first_name: c.firstName ?? c.first_name,
      last_name: c.lastName ?? c.last_name,
      email: c.email,
      phone: c.phone,
    };
  }

  private snakeAddress(addr: Rec | null): Rec | null {
    if (!addr) return null;
    return {
      first_name: addr.firstName ?? addr.first_name,
      last_name: addr.lastName ?? addr.last_name,
      address1: addr.address1 ?? addr.line1,
      address2: addr.address2 ?? addr.line2,
      city: addr.city,
      province: addr.province ?? addr.state,
      country: addr.country,
      zip: addr.zip ?? addr.pincode,
      phone: addr.phone,
    };
  }

  shopifyOrderList(ratioResponse: unknown): Rec {
    const orders = Array.isArray(ratioResponse)
      ? ratioResponse
      : ((ratioResponse as Rec)?.orders as unknown[] | undefined) ??
        ((ratioResponse as Rec)?.data as unknown[] | undefined) ??
        [];
    return { orders: (orders as Rec[]).map((o) => this.shopifyOrder(o)) };
  }

  // ── Transaction extraction ────────────────────────────────────────────────

  extractTransactions(ratioOrder: Rec): Rec[] {
    const id = this.numericId(String(ratioOrder.id ?? ''));
    const payment = ratioOrder.paymentDetails as Rec | null;
    return [
      {
        id,
        order_id: id,
        kind: 'sale',
        status: 'success',
        amount: this.paiseToRupees(ratioOrder.totalAmount as number),
        currency: 'INR',
        authorization: payment?.payment_id ?? payment?.paymentId ?? null,
        receipt: payment ?? {},
        created_at: this.isoDate((ratioOrder.createdAt ?? ratioOrder.created_at) as string),
      },
    ];
  }

  // ── Customer transformation ───────────────────────────────────────────────

  shopifyCustomer(
    ratioCustomer: Rec,
    ordersCount = 0,
    totalSpentPaise = 0,
  ): Rec {
    const id = this.numericId(String(ratioCustomer.id ?? ''));
    const isBlocked = ratioCustomer.isBlocked ?? ratioCustomer.is_blocked;
    return {
      id,
      first_name: ratioCustomer.firstName ?? ratioCustomer.first_name,
      last_name: ratioCustomer.lastName ?? ratioCustomer.last_name,
      email: ratioCustomer.email,
      phone: ratioCustomer.phone,
      state: isBlocked ? 'disabled' : 'enabled',
      orders_count: ordersCount,
      total_spent: this.paiseToRupees(totalSpentPaise),
    };
  }

  // ── Product transformation ────────────────────────────────────────────────

  shopifyProduct(ratioProduct: Rec): Rec {
    const id = this.numericId(String(ratioProduct.id ?? ''));
    const variants = Array.isArray(ratioProduct.variants)
      ? (ratioProduct.variants as Rec[]).map((v) => ({
          id: this.numericId(String(v.id ?? '')),
          product_id: id,
          title: v.title,
          sku: v.sku,
          price: this.paiseToRupees(v.price as number),
          compare_at_price: v.compare_at_price
            ? this.paiseToRupees(v.compare_at_price as number)
            : null,
          inventory_quantity: v.inventory_quantity ?? v.inventoryQuantity ?? 0,
          option1: v.option1 ?? null,
          option2: v.option2 ?? null,
          option3: v.option3 ?? null,
        }))
      : [];

    return {
      id,
      title: ratioProduct.title,
      handle: ratioProduct.handle,
      vendor: ratioProduct.vendor,
      product_type: ratioProduct.product_type ?? ratioProduct.productType,
      status: ratioProduct.status,
      images: Array.isArray(ratioProduct.images) ? ratioProduct.images : [],
      variants,
    };
  }

  // ── Refund transformation ─────────────────────────────────────────────────

  shopifyRefund(ratioRefund: Rec, orderId: string): Rec {
    const id = this.numericId(String(ratioRefund.id ?? ''));
    const oId = this.numericId(orderId);
    const lineItems = Array.isArray(ratioRefund.lineItems)
      ? (ratioRefund.lineItems as Rec[]).map((item) => ({
          id: this.numericId(String(item.id ?? '')),
          line_item_id: this.numericId(String(item.lineItemId ?? item.line_item_id ?? '')),
          quantity: item.quantity,
          restock_type: 'return',
        }))
      : [];

    return {
      id,
      order_id: oId,
      created_at: this.isoDate((ratioRefund.createdAt ?? ratioRefund.created_at) as string),
      refund_line_items: lineItems,
      transactions: [
        {
          id,
          order_id: oId,
          amount: this.paiseToRupees(ratioRefund.amount as number),
          currency: 'INR',
          kind: 'refund',
          status: 'success',
        },
      ],
    };
  }

  shopifyRefundList(ratioResponse: unknown, orderId: string): Rec {
    const refunds = Array.isArray(ratioResponse)
      ? ratioResponse
      : ((ratioResponse as Rec)?.refunds as unknown[] | undefined) ??
        ((ratioResponse as Rec)?.data as unknown[] | undefined) ??
        [];
    return { refunds: (refunds as Rec[]).map((r) => this.shopifyRefund(r, orderId)) };
  }

  // ── Inbound request body mapping (RP → Ratio) ─────────────────────────────

  /**
   * Map RP's Shopify-format refund request body to OS Order Service shape.
   *
   * RP sends:
   *   { refund: { refund_line_items: [{line_item_id, quantity, restock_type}],
   *               shipping: {full_refund: bool}, note } }
   *
   * OS Order Service expects:
   *   { order_id, line_items: [{line_item_id, quantity}],
   *     include_shipping, restock_type, notify_customer, reason }
   *
   * order_id is merged in by the service layer from the URL :id param.
   */
  mapRefundRequest(rpBody: Rec): Rec {
    const refund = (rpBody?.refund ?? rpBody) as Rec;
    const refundLineItems = Array.isArray(refund.refund_line_items)
      ? (refund.refund_line_items as Rec[]).map((li) => ({
          line_item_id: String(li.line_item_id ?? ''),
          quantity: Number(li.quantity ?? 1),
        }))
      : [];
    const shipping = refund.shipping as Rec | null | undefined;
    return {
      line_items: refundLineItems,
      include_shipping: shipping?.full_refund === true,
      restock_type: 'CANCEL',
      notify_customer: true,
      reason: typeof refund.note === 'string' ? refund.note : 'Customer requested return',
    };
  }

  /** Parse RP's customer search query param. "email:foo@bar.com" → "foo@bar.com" */
  parseCustomerSearchQuery(query: string | undefined): { email?: string } {
    if (!query) return {};
    const match = query.match(/^email:(.+)$/i);
    if (match?.[1]) return { email: match[1].trim() };
    return {};
  }
}
