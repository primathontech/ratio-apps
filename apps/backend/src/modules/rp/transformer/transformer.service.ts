import { Injectable } from '@nestjs/common';
import { hashId } from '../id-mapping/hash-id';

type Rec = Record<string, unknown>;

@Injectable()
export class RpTransformerService {
  /**
   * Map any OS id (Shopify-style numeric, OS-native 18-digit, or UUID) to a stable
   * JS-SAFE integer string. Delegates to the shared canonical hash (id-mapping/hash-id.ts)
   * so every code path that mints a Shopify-shape id from a real OS id — this transformer,
   * normalize-order.ts — produces the exact same hash for the exact same real id.
   */
  numericId(value: string): string {
    return hashId(value);
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
    // Number(), not the raw numericId() string: RP's exchange-product validator stores
    // this id in Mongo from our JSON response, then strictly compares it (`.includes()`)
    // against the customer's exchange_product_id/exchange_variant_id — which Joi's
    // `number()` schema coerces to a real JS number. A string here silently fails that
    // comparison ("Unable to validate all products") even for a product that exists.
    const id = Number(this.numericId(String(ratioProduct.id ?? '')));
    const images = Array.isArray(ratioProduct.images) ? (ratioProduct.images as Rec[]) : [];
    // OS has no per-variant image association, so every variant points at the primary
    // (first) image — matching Shopify's own behavior for single-image products. Without
    // this, RP's productVariantImage() finds no images[].id === variant.image_id match,
    // falls through past the (also-missing) product.image, and shows its placeholder even
    // though real images exist in `images[]`.
    const primaryImageId = images[0]?.id ?? null;
    const variants = Array.isArray(ratioProduct.variants)
      ? (ratioProduct.variants as Rec[]).map((v) => {
        const variantId = Number(this.numericId(String(v.id ?? '')));
        return {
          id: variantId,
          // OS has no separate inventory-item entity — a variant's stock IS its inventory
          // record, unlike Shopify where they're distinct ids. RP's exchange-reserve flow
          // (reserveExchangeInventoryOnShopify) reads this straight off its cached product
          // object and round-trips it back to /rp/shopify/inventory_levels/adjust, so it
          // must be the same hashed id `resolveRealId('variant', …)` can reverse.
          inventory_item_id: variantId,
          product_id: id,
          title: v.title,
          sku: v.sku,
          price: this.paiseToRupees(v.price as number),
          compare_at_price: v.compare_at_price
            ? this.paiseToRupees(v.compare_at_price as number)
            : null,
          // SANDBOX TESTING ACCOMMODATION: the OS item catalog does not expose per-variant
          // inventory, so it arrives as 0/undefined and RP's exchange picker filters every
          // variant out ("no products for exchange"). Force a minimum of 1 so exchange
          // candidates are selectable during testing; a real positive value is preserved.
          // Remove/gate this once OS surfaces real inventory.
          inventory_quantity: Number(v.inventory_quantity ?? v.inventoryQuantity ?? 0) || 1,
          // RP's checkBlocked (return_prime_public/.../common.service.js) treats
          // `inventory_management === null` as Shopify's own shape for an
          // untracked-inventory variant and returns "not blocked" immediately, before
          // even looking at inventory_policy/inventory_quantity. Any other value —
          // including `undefined` from the key being absent, which is what happened
          // here before — falls through to "blocked", regardless of stock. OS doesn't
          // expose per-variant inventory tracking to this adapter (same reason as the
          // inventory_quantity accommodation above), so null is the accurate mapping.
          inventory_management: null,
          // option1 must match the product `options` values (below) so RP's variant matcher
          // resolves a selection; OS variants have no named options, so fall back to the title.
          option1: v.option1 ?? v.title ?? 'Default Title',
          option2: v.option2 ?? null,
          option3: v.option3 ?? null,
          image_id: primaryImageId,
        };
      })
      : [];

    // RP's exchange product search requires published_at != null and status active.
    // Carry through OS publish/status info (fall back to created_at, else now) so
    // synced products are actually searchable in the exchange picker.
    const publishedAt =
      this.isoDate((ratioProduct.published_at ?? ratioProduct.publishedAt) as string) ??
      this.isoDate((ratioProduct.created_at ?? ratioProduct.createdAt) as string) ??
      new Date().toISOString();

    // Shopify products always carry an `options` array, and RP's portal reads
    // `options[0].name` (SelectVariant) — an empty array crashes it. OS has no named
    // product options, so emit Shopify's single-variant default: one "Title" option whose
    // values are the variant titles (variant.option1 is set from these too).
    const optionValues = [
      ...new Set(
        variants.map(
          (v) => (v.option1 as string) || (v.title as string) || 'Default Title',
        ),
      ),
    ];
    const options = [{ name: 'Title', position: 1, values: optionValues.length ? optionValues : ['Default Title'] }];

    return {
      id,
      title: ratioProduct.title,
      handle: ratioProduct.handle,
      vendor: ratioProduct.vendor,
      product_type: ratioProduct.product_type ?? ratioProduct.productType,
      status: (ratioProduct.status as string) || 'active',
      options,
      published_at: publishedAt,
      published_scope: (ratioProduct.published_scope as string) ?? 'web',
      created_at: this.isoDate((ratioProduct.created_at ?? ratioProduct.createdAt) as string),
      updated_at: this.isoDate((ratioProduct.updated_at ?? ratioProduct.updatedAt) as string),
      tags: ratioProduct.tags ?? '',
      image: images[0] ?? null,
      images,
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

  /**
   * Map the OS refund-calculate response into the Shopify calculate shape RP's refund flow
   * expects (actualSource.helper reads `transactions[].maximum_refundable`, `refund_line_items`,
   * `currency`). OS returns paise integers; convert to rupee decimal strings like everywhere else.
   */
  shopifyRefundCalculate(ratioCalc: Rec, orderId: string): Rec {
    const calc = ((ratioCalc?.data as Rec) ?? ratioCalc ?? {}) as Rec;
    const oId = this.numericId(orderId);
    const lineItems = Array.isArray(calc.lineItems) ? (calc.lineItems as Rec[]) : [];
    const refundLineItems = lineItems.map((li) => ({
      line_item_id: this.numericId(String(li.lineItemId ?? li.line_item_id ?? '')),
      quantity: Number(li.quantity ?? 0),
      subtotal: this.paiseToRupees(li.totalAmount as number),
      total_tax: this.paiseToRupees(li.taxAmount as number),
      restock_type: 'return',
    }));
    return {
      currency: (calc.currency as string) ?? 'INR',
      shipping: {
        amount: this.paiseToRupees(calc.shippingAmount as number),
        maximum_refundable: this.paiseToRupees(calc.shippingAmount as number),
      },
      refund_line_items: refundLineItems,
      transactions: [
        {
          order_id: oId,
          kind: 'suggested_refund',
          gateway: 'ReturnPrime',
          amount: this.paiseToRupees(calc.totalAmount as number),
          maximum_refundable: this.paiseToRupees(calc.totalRefundable as number),
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

  /**
   * Map a Shopify REST Order create body (what RP's createExchangeOrder builds and
   * ShopifyAxios.createOrder would POST as `{order}`) into the OS CreateOrderDto.
   * OS accepts rupee decimal strings for amounts (verified against the live API),
   * so no paise conversion is applied here.
   */
  mapCreateOrder(shopifyOrder: Rec): Rec {
    const o = (shopifyOrder?.order ?? shopifyOrder) as Rec;

    const lineItems = Array.isArray(o.line_items)
      ? (o.line_items as Rec[]).map((li) => ({
          variant_id: li.variant_id != null ? String(li.variant_id) : undefined,
          product_id: li.product_id != null ? String(li.product_id) : undefined,
          title: (li.title ?? li.name) as string | undefined,
          variant_title: li.variant_title as string | undefined,
          quantity: Number(li.quantity ?? 1),
          price: String(li.price ?? '0'),
          sku: li.sku as string | undefined,
          tax_lines: li.tax_lines,
          discount_allocations: li.discount_allocations,
        }))
      : [];

    // OS expects `tags` as a comma-separated STRING (matching Shopify), not an array.
    const tags =
      typeof o.tags === 'string'
        ? (o.tags as string)
        : Array.isArray(o.tags)
          ? (o.tags as unknown[]).join(',')
          : '';

    // Drop undefined keys so OS validation doesn't trip on nulls it doesn't expect.
    const dto: Rec = {
      email: o.email,
      phone: o.phone,
      note: o.note,
      tags,
      source_name: 'ReturnPrime',
      payment_gateway_names: o.payment_gateway_names,
      financial_status: o.financial_status,
      fulfillment_status: o.fulfillment_status ?? null,
      status: 'open',
      currency: o.currency ?? 'INR',
      customer: o.customer ?? undefined,
      shipping_address: o.shipping_address ?? undefined,
      billing_address: o.billing_address ?? undefined,
      line_items: lineItems,
      shipping_lines: o.shipping_lines,
      discount_codes: o.discount_codes,
      tax_lines: o.tax_lines,
      total_tax: o.total_tax != null ? String(o.total_tax) : undefined,
      total_price: o.price != null ? String(o.price) : o.total_price != null ? String(o.total_price) : undefined,
      note_attributes: o.note_attributes,
      name: o.name,
    };
    for (const k of Object.keys(dto)) if (dto[k] === undefined) delete dto[k];
    return dto;
  }

  /** Parse RP's customer search query param. "email:foo@bar.com" → "foo@bar.com" */
  parseCustomerSearchQuery(query: string | undefined): { email?: string } {
    if (!query) return {};
    const match = query.match(/^email:(.+)$/i);
    if (match?.[1]) return { email: match[1].trim() };
    return {};
  }
}
