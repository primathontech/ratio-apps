import { describe, it, expect } from 'vitest';
import { normalizeOrder } from './normalize-order';

const baseLine = {
  id: 'line_001',
  variant_id: 'var_001',
  product_id: 'prod_001',
  title: 'Test Product',
  price: '100.00',
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
