// Converts a UUID or arbitrary string to a deterministic numeric string
// by parsing the first 15 hex digits as base-16. Matches transformer.service.ts logic.
function numericIdFromString(value: string): number {
  if (!value) return 0;
  const direct = Number(value);
  if (!isNaN(direct) && direct > 0 && direct <= Number.MAX_SAFE_INTEGER) return direct;
  const hexStr = !isNaN(direct) && direct > 0
    ? BigInt(value).toString(16)
    : value.replace(/-/g, '').replace(/[^0-9a-f]/gi, '');
  const hex = hexStr.slice(0, 13);
  return hex ? parseInt(hex, 16) : 0;
}

// Adds Shopify-compatible price_set / discounted_price_set fields that RP BE
// expects but that the OS order service doesn't include.
// Converts all IDs to numbers so RP Mongoose Number fields and comparisons work
// without any OS-awareness in the RP codebase.
export function normalizeOrder(order: Record<string, unknown>): Record<string, unknown> {
  const currency = (order.currency as string) || 'INR';

  // OS API returns all monetary values in paise (1 INR = 100 paise).
  // RP BE expects rupees, so divide by 100.
  const paiseToRupee = (val: string | number | unknown): number =>
    Number(val) / 100;

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
              price_set: moneySet(paiseToRupee(
                (tl.price_set as any)?.shop_money?.amount ?? (tl.price_set as any)?.shopMoney?.amount ?? tl.price ?? 0
              )),
            }))
          : [];
        const discountAllocations = Array.isArray(li.discount_allocations)
          ? li.discount_allocations.map((da: Record<string, unknown>) => ({
              ...da,
              amount_set: moneySet(paiseToRupee(
                (da.amount_set as any)?.shop_money?.amount ?? (da.amount_set as any)?.shopMoney?.amount ?? da.amount ?? 0
              )),
            }))
          : [];
        // Shopify uses snake_case (presentment_money / shop_money); OS uses camelCase.
        // OS amounts are in paise — divide by 100 to get rupees.
        const priceSet = li.price_set as Record<string, unknown> | undefined;
        const rawPresentment = (priceSet?.presentment_money ?? (priceSet as any)?.presentmentMoney) as Record<string, unknown> | undefined;
        const rawShop = (priceSet?.shop_money ?? (priceSet as any)?.shopMoney) as Record<string, unknown> | undefined;
        const normalizedPriceSet = priceSet
          ? {
              presentment_money: {
                ...(rawPresentment ?? {}),
                amount: String(paiseToRupee(rawPresentment?.amount ?? li.price ?? 0)),
                currency_code: String(rawPresentment?.currency_code ?? (rawPresentment as any)?.currencyCode ?? currency),
              },
              shop_money: {
                ...(rawShop ?? {}),
                amount: String(paiseToRupee(rawShop?.amount ?? li.price ?? 0)),
                currency_code: String(rawShop?.currency_code ?? (rawShop as any)?.currencyCode ?? currency),
              },
            }
          : moneySet(paiseToRupee(li.price ?? 0));
        // If order is fulfilled but the OS API didn't propagate it to line items,
        // derive fulfillment_status from the order level so RP can mark items returnable.
        const orderFs = order.fulfillment_status as string | null | undefined;
        const liFs = li.fulfillment_status as string | null | undefined;
        const derivedFs =
          orderFs === 'fulfilled' && (!liFs || liFs === 'unfulfilled') ? 'fulfilled' :
          orderFs === 'partial' && (!liFs || liFs === 'unfulfilled') ? 'partial' :
          liFs ?? null;

        // Shopify semantics: fulfillable_quantity = units still awaiting fulfillment.
        // RP derives the return/exchange-able quantity as (quantity - fulfillable_quantity),
        // so a fulfilled item must report 0 here — otherwise RP shows 0 exchangeable units
        // (empty qty dropdown). OS often omits this, so derive it from the fulfillment status.
        const liQty = Number(li.quantity ?? 0);
        const fulfillableQuantity =
          derivedFs === 'fulfilled' ? 0 :
          (li.fulfillable_quantity != null ? Number(li.fulfillable_quantity) : liQty);

        return {
          ...li,
          fulfillment_status: derivedFs,
          fulfillable_quantity: fulfillableQuantity,
          id: numericIdFromString(String(li.id ?? '')),
          variant_id: li.variant_id != null ? numericIdFromString(String(li.variant_id)) : null,
          product_id: li.product_id != null ? numericIdFromString(String(li.product_id)) : null,
          // Preserve original OS product/variant IDs so the adapter can reverse-lookup
          // the real OS ID when RP sends the hashed product_id back (e.g. fetchOriginalProduct).
          os_product_id: li.product_id != null ? String(li.product_id) : null,
          os_variant_id: li.variant_id != null ? String(li.variant_id) : null,
          name: (li.name as string) ?? (li.title as string) ?? '',
          price: String(paiseToRupee(li.price ?? 0)),
          price_set: normalizedPriceSet,
          tax_lines: taxLines,
          discount_allocations: discountAllocations,
        };
      })
    : [];

  // Normalize shipping_lines — OS amounts are in paise
  const shippingLines = Array.isArray(order.shipping_lines)
    ? order.shipping_lines.map((sl: Record<string, unknown>) => ({
        ...sl,
        price: String(paiseToRupee(sl.price ?? 0)),
        price_set: moneySet(paiseToRupee(
          (sl.price_set as any)?.shop_money?.amount ?? (sl.price_set as any)?.shopMoney?.amount ?? sl.price ?? 0
        )),
        discounted_price_set: moneySet(paiseToRupee(
          (sl.discounted_price_set as any)?.shop_money?.amount ?? (sl.discounted_price_set as any)?.shopMoney?.amount ?? sl.discounted_price ?? sl.price ?? 0
        )),
      }))
    : [];

  // Use order_number as the Shopify-compatible id — always a safe integer (e.g. 2484).
  // This makes the round-trip reversible: RP passes 2484 back to the adapter, the adapter
  // searches OS order service by order_number to recover the real ordr_XXXX OS ID.
  const rawId = String(order.id ?? '');
  const strippedId = rawId.replace(/^ordr_/i, '');
  const rawOrderNumberInt = parseInt(String(order.order_number ?? 0), 10);
  const numericOrderId: number = rawOrderNumberInt > 0 ? rawOrderNumberInt : numericIdFromString(strippedId);

  // Normalize customer ID — OS uses UUID, Shopify uses numeric
  const customer = order.customer as Record<string, unknown> | null | undefined;
  const normalizedCustomer = customer
    ? { ...customer, id: numericIdFromString(String(customer.id ?? '')) }
    : customer;

  // Shopify always returns order_number as integer; GoKwik returns it as string.
  const rawOrderNumber = order.order_number;
  const orderNumber =
    rawOrderNumber != null ? parseInt(String(rawOrderNumber), 10) || rawOrderNumber : rawOrderNumber;

  // Synthesize Shopify-compatible fulfillments[] from order-level fulfillment_status
  // when the OS order service returns an empty fulfillments array.
  // RP's refund/return logic iterates fulfillments to find location_id and line item IDs.
  const rawFulfillments = Array.isArray(order.fulfillments) ? order.fulfillments : [];
  const fulfillmentStatus = order.fulfillment_status as string | null | undefined;
  const fulfillments =
    rawFulfillments.length === 0 && (fulfillmentStatus === 'fulfilled' || fulfillmentStatus === 'partial')
      ? [
          {
            id: numericOrderId || 1,
            status: 'success',
            location_id: null,
            created_at: order.created_at,
            line_items: lineItems.map((li) => ({ id: li.id, quantity: ((li as Record<string, unknown>).quantity as number) ?? 1 })),
          },
        ]
      : rawFulfillments;

  return {
    ...order,
    id: numericOrderId,
    order_number: orderNumber,
    customer: normalizedCustomer,
    line_items: lineItems,
    shipping_lines: shippingLines,
    fulfillments,
  };
}
