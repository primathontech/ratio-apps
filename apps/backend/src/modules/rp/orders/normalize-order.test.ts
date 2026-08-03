import { describe, it, expect } from 'vitest';
import { normalizeOrder } from './normalize-order';

const baseLine = {
  id: 'line_001',
  variant_id: 'var_001',
  product_id: 'prod_001',
  title: 'Test Product',
  price: '100.00',
  quantity: 1,
  fulfillment_status: null,
};

describe('normalizeOrder - fulfillments synthesis', () => {
  it('synthesizes a fulfilled fulfillment when fulfillment_status=fulfilled and fulfillments empty', () => {
    const order = {
      id: 'ordr_123',
      currency: 'INR',
      fulfillment_status: 'fulfilled',
      fulfillments: [],
      line_items: [baseLine],
      shipping_lines: [],
    };

    const result = normalizeOrder(order) as Record<string, unknown>;
    const fulfillments = result.fulfillments as unknown[];
    expect(fulfillments).toHaveLength(1);
    const f = fulfillments[0] as Record<string, unknown>;
    expect(f.status).toBe('success');
    expect(Array.isArray(f.line_items)).toBe(true);
    const lineItems = f.line_items as Array<Record<string, unknown>>;
    expect(lineItems.length).toBeGreaterThan(0);
    expect(lineItems[0]).toHaveProperty('id');
  });

  it('does NOT synthesize when fulfillments already populated', () => {
    const existingFulfillment = { id: 999, status: 'success', line_items: [{ id: 1 }], location_id: null };
    const order = {
      id: 'ordr_456',
      currency: 'INR',
      fulfillment_status: 'fulfilled',
      fulfillments: [existingFulfillment],
      line_items: [baseLine],
      shipping_lines: [],
    };

    const result = normalizeOrder(order) as Record<string, unknown>;
    const fulfillments = result.fulfillments as unknown[];
    expect(fulfillments).toHaveLength(1);
    expect((fulfillments[0] as Record<string, unknown>).id).toBe(999);
  });

  it('does NOT synthesize when fulfillment_status is not fulfilled', () => {
    const order = {
      id: 'ordr_789',
      currency: 'INR',
      fulfillment_status: null,
      fulfillments: [],
      line_items: [baseLine],
      shipping_lines: [],
    };

    const result = normalizeOrder(order) as Record<string, unknown>;
    expect(result.fulfillments).toEqual([]);
  });

  it('does NOT synthesize when fulfillments key is missing', () => {
    const order = {
      id: 'ordr_abc',
      currency: 'INR',
      fulfillment_status: null,
      line_items: [],
      shipping_lines: [],
    };

    const result = normalizeOrder(order) as Record<string, unknown>;
    expect(result.fulfillments).toEqual([]);
  });
});

describe('normalizeOrder - fulfillments synthesis - partial fulfillment quantities', () => {
  it('reports the actually-fulfilled quantity (quantity - fulfillable_quantity) for a partially-shipped line item, not the full order quantity', () => {
    const order = {
      id: 'ordr_777',
      currency: 'INR',
      fulfillment_status: 'partial',
      fulfillments: [],
      line_items: [{ ...baseLine, quantity: 3, fulfillment_status: 'partial', fulfillable_quantity: 1 }],
      shipping_lines: [],
    };

    const result = normalizeOrder(order) as Record<string, unknown>;
    const fulfillments = result.fulfillments as Array<Record<string, unknown>>;
    expect(fulfillments).toHaveLength(1);
    const lineItems = fulfillments[0]!.line_items as Array<Record<string, unknown>>;
    // 3 ordered, 1 still fulfillable => 2 actually shipped, not the full 3
    expect(lineItems[0]?.quantity).toBe(2);
  });

  it('excludes a still-fully-unfulfilled line item from the synthesized fulfillment entirely', () => {
    const order = {
      id: 'ordr_888',
      currency: 'INR',
      fulfillment_status: 'partial',
      fulfillments: [],
      line_items: [
        { ...baseLine, id: 'line_shipped', quantity: 2, fulfillment_status: 'fulfilled', fulfillable_quantity: 0 },
        { ...baseLine, id: 'line_unshipped', quantity: 2, fulfillment_status: 'unfulfilled', fulfillable_quantity: 2 },
      ],
      shipping_lines: [],
    };

    const result = normalizeOrder(order) as Record<string, unknown>;
    const fulfillments = result.fulfillments as Array<Record<string, unknown>>;
    expect(fulfillments).toHaveLength(1);
    const lineItems = fulfillments[0]!.line_items as Array<Record<string, unknown>>;
    // Only the shipped line item should appear — a real Shopify fulfillment never lists
    // an item that wasn't actually in that shipment.
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0]?.quantity).toBe(2);
  });
});

describe('normalizeOrder - customer.tags default', () => {
  // Real OS customer objects have no `tags` field at all ({id, email, phone} only) —
  // Shopify's always does (even if just an empty string). RP has ~14 call sites across
  // returnFeeRule.service.js/promotion.service.js/rpAdvantage.service.js that read
  // `customer.tags.split(',')` guarded only on `customer` being truthy, not `customer.tags`
  // — an OS order with no tags field crashes them with "Cannot read properties of
  // undefined (reading 'split')" (confirmed live: RETURN_FEE_RULE_E15 wraps exactly this).
  it('defaults tags to an empty string when the raw customer has none', () => {
    const order = {
      id: 'ordr_1',
      currency: 'INR',
      line_items: [],
      shipping_lines: [],
      customer: { id: 'e4d643ce-8ed6-4145-bc1c-f0ba16a6650a', email: 'a@b.com', phone: '123' },
    };
    const result = normalizeOrder(order) as Record<string, unknown>;
    const customer = result.customer as Record<string, unknown>;
    expect(customer.tags).toBe('');
  });

  it('preserves an already-present tags value unchanged', () => {
    const order = {
      id: 'ordr_2',
      currency: 'INR',
      line_items: [],
      shipping_lines: [],
      customer: { id: 'cust-1', tags: 'vip, repeat' },
    };
    const result = normalizeOrder(order) as Record<string, unknown>;
    const customer = result.customer as Record<string, unknown>;
    expect(customer.tags).toBe('vip, repeat');
  });

  it('leaves a missing customer as-is (no crash)', () => {
    const order = { id: 'ordr_3', currency: 'INR', line_items: [], shipping_lines: [] };
    const result = normalizeOrder(order) as Record<string, unknown>;
    expect(result.customer).toBeUndefined();
  });
});

describe('normalizeOrder - id normalization', () => {
  it('strips ordr_ prefix and returns a numeric id', () => {
    const order = {
      id: 'ordr_12345678901',
      currency: 'INR',
      fulfillment_status: null,
      line_items: [],
      shipping_lines: [],
    };
    const result = normalizeOrder(order) as Record<string, unknown>;
    expect(typeof result.id).toBe('number');
    expect(result.id).toBeGreaterThan(0);
  });
});

describe('normalizeOrder - line item fulfillment_status derivation', () => {
  it('derives fulfilled on line items when order is fulfilled but items are unfulfilled', () => {
    const order = {
      id: 'ordr_111',
      currency: 'INR',
      fulfillment_status: 'fulfilled',
      fulfillments: [],
      line_items: [{ ...baseLine, fulfillment_status: 'unfulfilled' }],
      shipping_lines: [],
    };
    const result = normalizeOrder(order) as Record<string, unknown>;
    const items = result.line_items as Array<Record<string, unknown>>;
    expect(items[0]?.fulfillment_status).toBe('fulfilled');
  });

  it('sets fulfillable_quantity=0 for a fulfilled item so RP shows the full exchangeable qty', () => {
    const order = {
      id: 'ordr_222',
      currency: 'INR',
      fulfillment_status: 'fulfilled',
      fulfillments: [],
      line_items: [{ ...baseLine, quantity: 2, fulfillment_status: 'unfulfilled' }],
      shipping_lines: [],
    };
    const items = (normalizeOrder(order) as Record<string, unknown>).line_items as Array<Record<string, unknown>>;
    // quantity - fulfillable_quantity = 2 - 0 = 2 exchangeable units
    expect(items[0]?.fulfillable_quantity).toBe(0);
  });

  it('leaves fulfillable_quantity = quantity for an unfulfilled item (nothing exchangeable)', () => {
    const order = {
      id: 'ordr_333',
      currency: 'INR',
      fulfillment_status: null,
      fulfillments: [],
      line_items: [{ ...baseLine, quantity: 2, fulfillment_status: 'unfulfilled' }],
      shipping_lines: [],
    };
    const items = (normalizeOrder(order) as Record<string, unknown>).line_items as Array<Record<string, unknown>>;
    expect(items[0]?.fulfillable_quantity).toBe(2);
  });
});

describe('normalizeOrder - returnable/exchangeable derivation', () => {
  // Regression: RP's customer.service.js only NARROWS an already-present
  // returnable/exchangeable boolean (e.g. `datum.returnable && !hasNonReturnableTag`)
  // — it never computes a base value. Real Shopify orders get that boolean from
  // Shopify's own API; OS has no equivalent, so without this every OS order line
  // item silently evaluated as non-returnable regardless of fulfillment/policy.
  it('marks a fulfilled line item returnable and exchangeable', () => {
    const order = {
      id: 'ordr_444',
      currency: 'INR',
      fulfillment_status: 'fulfilled',
      fulfillments: [],
      line_items: [{ ...baseLine, quantity: 1, fulfillment_status: 'unfulfilled' }],
      shipping_lines: [],
    };
    const items = (normalizeOrder(order) as Record<string, unknown>).line_items as Array<Record<string, unknown>>;
    expect(items[0]?.returnable).toBe(true);
    expect(items[0]?.exchangeable).toBe(true);
  });

  it('marks an unfulfilled line item non-returnable and non-exchangeable', () => {
    const order = {
      id: 'ordr_555',
      currency: 'INR',
      fulfillment_status: null,
      fulfillments: [],
      line_items: [{ ...baseLine, quantity: 1, fulfillment_status: 'unfulfilled' }],
      shipping_lines: [],
    };
    const items = (normalizeOrder(order) as Record<string, unknown>).line_items as Array<Record<string, unknown>>;
    expect(items[0]?.returnable).toBe(false);
    expect(items[0]?.exchangeable).toBe(false);
  });

  it('does not override an explicit returnable/exchangeable value if OS ever supplies one', () => {
    const order = {
      id: 'ordr_666',
      currency: 'INR',
      fulfillment_status: 'fulfilled',
      fulfillments: [],
      line_items: [{ ...baseLine, quantity: 1, fulfillment_status: 'unfulfilled', returnable: false, exchangeable: false }],
      shipping_lines: [],
    };
    const items = (normalizeOrder(order) as Record<string, unknown>).line_items as Array<Record<string, unknown>>;
    expect(items[0]?.returnable).toBe(false);
    expect(items[0]?.exchangeable).toBe(false);
  });
});
