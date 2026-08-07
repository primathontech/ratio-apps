import {
  CLEVERTAP_CHARGED_EVENT,
  CLEVERTAP_WEBHOOK_EVENT_NAMES,
  type ClevertapWebhookEventTopic,
} from '@ratio-app/shared/constants/clevertap-events';
import { describe, expect, it } from 'vitest';
import {
  buildIdempotencyKey,
  CLEVERTAP_MAX_ITEMS,
  deriveOrderEventName,
  describeUnmappableOrder,
  mapCustomerProfile,
  mapOrderEvent,
  normalizeIndianPhone,
  ORDER_UNMAPPABLE_NO_ID,
  ORDER_UNMAPPABLE_NO_IDENTITY,
  parseRupees,
} from '../../../../src/modules/clevertap/events/order-event.mapper';
import { CLEVERTAP_WEBHOOK_TOPICS } from '../../../../src/modules/clevertap/webhooks/topics';
import {
  customersCreatePayload,
  customersUpdatePayload,
  customersUpdateStringConsentPayload,
  customerWithoutContactPayload,
  customerWithoutIdPayload,
} from './helpers/fixtures/customer-payloads';
import {
  LINE_ITEM_PRICE_RUPEES,
  MONEY_CASES,
  ORDER_EXPECTED_IDENTITY,
  ORDER_ID,
  ORDER_TOPIC_CASES,
  ORDER_TOTAL_RUPEES,
  ORDER_UPDATED_AT,
  officialOrderPayload,
  ordersCancelledPayload,
  ordersCreatePayload,
  ordersDeletePayload,
  ordersEditedPayload,
  ordersFulfilledPayload,
  ordersPaidPayload,
  ordersPartiallyFulfilledPayload,
  ordersUpdatedPayload,
  orderWithCustomerEmailOnlyPayload,
  orderWithCustomerIdOnlyPayload,
  orderWithCustomerObjectPayload,
  orderWithEmailOnlyPayload,
  orderWithNestedCustomerIdOnlyPayload,
  orderWithoutIdentityPayload,
  orderWithoutIdPayload,
  orderWithoutLineItemsPayload,
} from './helpers/fixtures/order-payloads';

describe('REGRESSION: order money is RUPEES — a ₹1200 order is Amount 1200, never 12', () => {
  const mapped = mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, ordersPaidPayload);
  const evtData = mapped?.records[0]?.evtData ?? {};
  const items = (evtData.Items ?? []) as Record<string, unknown>[];

  it('maps total_price "1200.00" to Amount 1200 (NOT 12)', () => {
    expect(evtData.Amount).toBe(ORDER_TOTAL_RUPEES);
    expect(evtData.Amount).toBe(1200);
    expect(evtData.Amount).not.toBe(12);
  });

  it('maps line-item price "600.00" to Price 600 (NOT 6)', () => {
    expect(items[0]?.Price).toBe(LINE_ITEM_PRICE_RUPEES);
    expect(items[0]?.Price).toBe(600);
    expect(items[0]?.Price).not.toBe(6);
  });

  it('never divides an order money field by 100', () => {
    expect(evtData.Amount).toBe(Number(ordersPaidPayload.total_price));
    expect(items[0]?.Price).toBe(Number(ordersPaidPayload.line_items[0]?.price));
  });

  it('holds for every one of the eight order topics (identical shape)', () => {
    for (const { topic, payload } of ORDER_TOPIC_CASES) {
      const data = mapOrderEvent(topic, payload)?.records[0]?.evtData ?? {};
      expect(data.Amount, topic).toBe(1200);
      expect((data.Items as Record<string, unknown>[])[0]?.Price, topic).toBe(600);
    }
  });
});

describe('parseRupees — parses, never scales', () => {
  it.each(MONEY_CASES)('reads $label ($raw) as $rupees', ({ raw, rupees }) => {
    expect(parseRupees(raw)).toBe(rupees);
  });

  it('reads a decimal string and the equivalent number identically', () => {
    expect(parseRupees('1200.00')).toBe(parseRupees(1200));
    expect(parseRupees('0.00')).toBe(parseRupees(0));
    expect(parseRupees('499.50')).toBe(parseRupees(499.5));
  });

  it('reads "0.00" as exactly 0', () => {
    expect(parseRupees('0.00')).toBe(0);
    expect(Object.is(parseRupees('0.00'), 0)).toBe(true);
  });

  it('never returns NaN for junk — a NaN Amount makes CleverTap drop the record', () => {
    for (const junk of [undefined, null, '', 'abc', {}, [], Number.NaN, Infinity]) {
      expect(parseRupees(junk)).toBe(0);
    }
  });

  it('is the identity on rupee values, not a division', () => {
    for (const value of [1, 60, 600, 1200, 155_900]) {
      expect(parseRupees(value)).toBe(value);
      expect(parseRupees(String(value))).toBe(value);
    }
  });
});

describe('mapOrderEvent — payment_details', () => {
  const evtData =
    mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, {
      ...ordersPaidPayload,
      payment_details: {
        paymentAmount: 219,
        paymentId: 'KWIKCJK8VRO77061315MS',
        paymentInstrument: 'upi',
        paymentMethod: 'prepaid',
        pgPaymentTrnxId: 'gw_hFuGu_4I5szkOdp9',
      },
    })?.records[0]?.evtData ?? {};

  it('carries payment method / instrument / ids onto the Charged event', () => {
    expect(evtData['Payment Method']).toBe('prepaid');
    expect(evtData['Payment Instrument']).toBe('upi');
    expect(evtData['Payment Id']).toBe('KWIKCJK8VRO77061315MS');
    expect(evtData['PG Transaction Id']).toBe('gw_hFuGu_4I5szkOdp9');
  });

  it('omits payment fields when payment_details is absent', () => {
    const data = mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, ordersPaidPayload)?.records[0]
      ?.evtData;
    expect(data).toBeDefined();
    expect('Payment Method' in (data ?? {})).toBe(false);
  });
});

describe('mapOrderEvent — money from the official payload', () => {
  const evtData =
    mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, ordersPaidPayload)?.records[0]?.evtData ??
    {};

  it('reads the discount string "0.00" as 0', () => {
    expect(evtData.Discount).toBe(0);
  });

  it('reads a discount that IS set, as rupees', () => {
    const mapped = mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, {
      ...ordersPaidPayload,
      total_discounts: '60.00',
    });
    expect(mapped?.records[0]?.evtData?.Discount).toBe(60);
  });

  it('accepts a line-item price that arrives as a NUMBER, not a string', () => {
    const mapped = mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, {
      ...ordersPaidPayload,
      total_price: 1200,
      line_items: [{ id: 'li', title: 'Thing', quantity: 1, price: 600 }],
    });
    const data = mapped?.records[0]?.evtData ?? {};
    expect(data.Amount).toBe(1200);
    expect((data.Items as Record<string, unknown>[])[0]?.Price).toBe(600);
  });

  it('falls back to total_price_set.shop_money.amount (rupees there too)', () => {
    const { total_price: _drop, ...withoutScalar } = ordersPaidPayload;
    const mapped = mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, withoutScalar);
    expect(mapped?.records[0]?.evtData?.Amount).toBe(1200);
  });

  it('falls back to line-item price_set.shopMoney.amount (the docs camelCase it)', () => {
    const mapped = mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, {
      ...ordersPaidPayload,
      line_items: [
        {
          id: 'li',
          title: 'Cotton T-Shirt',
          quantity: 1,
          price_set: { shopMoney: { amount: '600.00', currencyCode: 'INR' } },
        },
      ],
    });
    const items = mapped?.records[0]?.evtData?.Items as Record<string, unknown>[];
    expect(items[0]?.Price).toBe(600);
  });

  it('never emits a 100x-shrunken amount anywhere in the outbound body', () => {
    const body = JSON.stringify(
      mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, ordersPaidPayload),
    );
    expect(body).toContain('1200');
    expect(body).not.toContain(':12,');
    expect(body).not.toContain(':6,');
  });

  it('the fixture money fields ARE decimal rupee strings (docs guard)', () => {
    expect(officialOrderPayload.total_price).toBe('1200.00');
    expect(officialOrderPayload.line_items[0]?.price).toBe('600.00');
    for (const field of ['total_price', 'subtotal_price', 'total_discounts'] as const) {
      expect(typeof officialOrderPayload[field], field).toBe('string');
      expect(String(officialOrderPayload[field]), field).toContain('.');
    }
  });
});

describe('normalizeIndianPhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+919876543210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['(98765) 43210', '+919876543210'],
    ['+919800000000', '+919800000000'],
  ])('normalises %s to %s', (raw, expected) => {
    expect(normalizeIndianPhone(raw)).toBe(expected);
  });

  it('does not double-prefix an already-normalised number (idempotent)', () => {
    const once = normalizeIndianPhone('9876543210');
    expect(once).toBe('+919876543210');
    expect(normalizeIndianPhone(once)).toBe(once);
    expect(normalizeIndianPhone(once)).not.toContain('+91+91');
  });

  it('rejects non-Indian-mobile input rather than minting a junk identity', () => {
    for (const bad of ['', '12345', '1234567890', 'not-a-phone', '+1 415 555 0100', null, 42]) {
      expect(normalizeIndianPhone(bad)).toBeNull();
    }
  });
});

describe('mapOrderEvent — identity (CleverTap error 523 guard)', () => {
  const identityOf = (order: Record<string, unknown>) =>
    mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, order)?.records[0]?.identity;

  it('uses the TOP-LEVEL phone when `customer` is null — the official payload case', () => {
    expect(officialOrderPayload.customer).toBeNull();
    expect(officialOrderPayload.customer_id).toBeNull();
    expect(identityOf(ordersPaidPayload)).toBe(ORDER_EXPECTED_IDENTITY);
    expect(identityOf(ordersPaidPayload)).toBe('+919800000000');
  });

  it('emits an identity for the official payload on ALL eight topics', () => {
    for (const { topic, payload } of ORDER_TOPIC_CASES) {
      expect(mapOrderEvent(topic, payload)?.records[0]?.identity, topic).toBe(
        ORDER_EXPECTED_IDENTITY,
      );
    }
  });

  it('normalises the top-level phone to +91XXXXXXXXXX (516 guard)', () => {
    expect(identityOf({ ...ordersPaidPayload, phone: '9876543210' })).toBe('+919876543210');
    expect(identityOf({ ...ordersPaidPayload, phone: '09876543210' })).toBe('+919876543210');
    expect(identityOf({ ...ordersPaidPayload, phone: '+91 98765 43210' })).toBe('+919876543210');
  });

  it('priority 2: customer.phone when there is no top-level phone', () => {
    expect(identityOf(orderWithCustomerObjectPayload)).toBe('+919876543210');
  });

  it('priority: a phone BEATS an email', () => {
    expect(orderWithCustomerObjectPayload.email).toBeTruthy();
    expect(identityOf(orderWithCustomerObjectPayload)).toBe('+919876543210');
    expect(identityOf(orderWithCustomerObjectPayload)).not.toContain('@');
  });

  it('priority: the TOP-LEVEL phone beats customer.phone', () => {
    expect(
      identityOf({
        ...ordersPaidPayload,
        phone: '+919800000000',
        customer: { id: 'c', phone: '9876543210' },
      }),
    ).toBe('+919800000000');
  });

  it('priority 3: the top-level email when no phone is usable', () => {
    expect(identityOf(orderWithEmailOnlyPayload)).toBe('buyer@example.com');
  });

  it('lowercases the email identity so one shopper is one profile', () => {
    expect(orderWithEmailOnlyPayload.email).toBe('Buyer@Example.COM');
    expect(identityOf(orderWithEmailOnlyPayload)).toBe('buyer@example.com');
  });

  it('priority 4: customer.email when the order-level email is empty', () => {
    expect(identityOf(orderWithCustomerEmailOnlyPayload)).toBe('fallback@example.com');
  });

  it('priority 5: top-level customer_id as the last-resort identifier', () => {
    expect(identityOf(orderWithCustomerIdOnlyPayload)).toBe('cust_9001');
  });

  it('priority 6: customer.id, the very last link in the chain', () => {
    expect(identityOf(orderWithNestedCustomerIdOnlyPayload)).toBe('cust_nested_42');
  });

  it('ignores a malformed phone and falls through instead of minting junk', () => {
    expect(identityOf({ ...ordersPaidPayload, phone: 'garbage' })).toBe('buyer@example.com');
    expect(identityOf({ ...ordersPaidPayload, phone: '+1 415 555 0100' })).toBe(
      'buyer@example.com',
    );
  });

  it('does not double-prefix an already-E.164 phone from the payload', () => {
    expect(identityOf(orderWithoutLineItemsPayload)).toBe('+919812345678');
  });

  it('returns null when the payload has NO usable identifier at all', () => {
    expect(
      mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, orderWithoutIdentityPayload),
    ).toBeNull();
  });

  it('never emits a record without an identity key', () => {
    for (const { topic, payload } of ORDER_TOPIC_CASES) {
      const record = mapOrderEvent(topic, payload)?.records[0];
      expect(record?.identity, topic).toBeTruthy();
      expect(JSON.stringify(record)).not.toContain('"identity":null');
    }
  });
});

describe('describeUnmappableOrder', () => {
  it('names the missing order id, with no subject to key a row on', () => {
    expect(describeUnmappableOrder(orderWithoutIdPayload)).toEqual({
      subjectId: null,
      reason: ORDER_UNMAPPABLE_NO_ID,
    });
  });

  it('names the missing identity, and keeps the order id so a row CAN be keyed', () => {
    expect(describeUnmappableOrder(orderWithoutIdentityPayload)).toEqual({
      subjectId: ORDER_ID,
      reason: ORDER_UNMAPPABLE_NO_IDENTITY,
    });
  });

  it('cites CleverTap 523 in the identity reason, and carries no PII', () => {
    const { reason } = describeUnmappableOrder(orderWithoutIdentityPayload);
    expect(reason).toContain('523');
    expect(reason).not.toContain('@');
    expect(reason).not.toContain('9800000000');
  });
});

describe('mapOrderEvent — event names', () => {
  const cases: [ClevertapWebhookEventTopic, string, Record<string, unknown>][] = [
    [CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, 'Charged', ordersPaidPayload],
    [CLEVERTAP_WEBHOOK_TOPICS.ordersCreate, 'Order Created', ordersCreatePayload],
    [CLEVERTAP_WEBHOOK_TOPICS.ordersCancelled, 'Order Cancelled', ordersCancelledPayload],
    [CLEVERTAP_WEBHOOK_TOPICS.ordersFulfilled, 'Order Fulfilled', ordersFulfilledPayload],
    [
      CLEVERTAP_WEBHOOK_TOPICS.ordersPartiallyFulfilled,
      'Order Partially Fulfilled',
      ordersPartiallyFulfilledPayload,
    ],
    [CLEVERTAP_WEBHOOK_TOPICS.ordersUpdated, 'Order Updated', ordersUpdatedPayload],
  ];

  it.each(cases)('%s maps to "%s"', (topic, expectedEvent, payload) => {
    const mapped = mapOrderEvent(topic, payload);
    expect(mapped?.clevertapEvent).toBe(expectedEvent);
    expect(mapped?.records[0]?.evtName).toBe(expectedEvent);
  });

  it('maps ALL EIGHT documented order topics to their CleverTap event name', () => {
    for (const { topic, event, payload } of ORDER_TOPIC_CASES) {
      const mapped = mapOrderEvent(topic, payload);
      expect(mapped?.clevertapEvent, topic).toBe(event);
      expect(mapped?.records[0]?.evtName, topic).toBe(event);
    }
    expect(ORDER_TOPIC_CASES).toHaveLength(8);
  });

  it('maps orders/paid to CleverTap\'s reserved "Charged" event (A7)', () => {
    const mapped = mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, ordersPaidPayload);
    expect(mapped?.clevertapEvent).toBe(CLEVERTAP_CHARGED_EVENT);
  });

  it('maps orders/create to "Order Created", NOT Charged (A8 — double-count guard)', () => {
    const mapped = mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersCreate, ordersCreatePayload);
    expect(mapped?.clevertapEvent).toBe('Order Created');
    expect(mapped?.clevertapEvent).not.toBe(CLEVERTAP_CHARGED_EVENT);
    expect(JSON.stringify(mapped)).not.toContain('Charged');
  });

  it('only orders/paid maps to Charged, across every order topic (A8)', () => {
    const chargedTopics = Object.entries(CLEVERTAP_WEBHOOK_EVENT_NAMES)
      .filter(([, name]) => name === CLEVERTAP_CHARGED_EVENT)
      .map(([topic]) => topic);
    expect(chargedTopics).toEqual(['orders/paid']);

    for (const { topic, event } of ORDER_TOPIC_CASES) {
      if (topic !== 'orders/paid') expect(event, topic).not.toBe(CLEVERTAP_CHARGED_EVENT);
    }
  });
});

describe('mapOrderEvent — the two order topics v1 does not handle', () => {
  it.each([
    ['orders/edited', 'Order Edited', ordersEditedPayload],
    ['orders/delete', 'Order Deleted', ordersDeletePayload],
  ])('%s yields a named event ("%s") from the identical shape', (topic, event, payload) => {
    const mapped = mapOrderEvent(topic, payload);
    expect(mapped).not.toBeNull();
    expect(mapped?.clevertapEvent).toBe(event);
    expect(mapped?.records[0]?.evtName).toBe(event);
    expect(mapped?.records[0]?.evtData?.Amount).toBe(1200);
    expect(mapped?.records[0]?.identity).toBe(ORDER_EXPECTED_IDENTITY);
  });

  it('keeps them OUT of the shared event-name table (no handler ⇒ no subscription)', () => {
    expect(Object.keys(CLEVERTAP_WEBHOOK_EVENT_NAMES)).not.toContain('orders/edited');
    expect(Object.keys(CLEVERTAP_WEBHOOK_EVENT_NAMES)).not.toContain('orders/delete');
  });

  it('neither becomes Charged', () => {
    for (const payload of [ordersEditedPayload, ordersDeletePayload]) {
      const mapped = mapOrderEvent(String(payload.event_type), payload);
      expect(mapped?.clevertapEvent).not.toBe(CLEVERTAP_CHARGED_EVENT);
      expect(mapped?.records[0]?.evtData).not.toHaveProperty('Charged ID');
    }
  });

  it('deriveOrderEventName title-cases any unknown order topic rather than returning undefined', () => {
    expect(deriveOrderEventName('orders/edited')).toBe('Order Edited');
    expect(deriveOrderEventName('orders/delete')).toBe('Order Deleted');
    expect(deriveOrderEventName('orders/risk_assessment_changed')).toBe(
      'Order Risk Assessment Changed',
    );
    expect(deriveOrderEventName('orders/paid')).toBe('Charged');
    expect(deriveOrderEventName('')).toBe('Order Updated');
  });
});

describe('mapOrderEvent — Charged body shape (A7)', () => {
  const mapped = mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, ordersPaidPayload);
  const record = mapped?.records[0];
  const evtData = record?.evtData ?? {};

  it('carries Amount, a charge id, and Items[]', () => {
    expect(evtData.Amount).toBe(1200);
    expect(evtData['Charged ID']).toBe(ORDER_ID);
    expect(Array.isArray(evtData.Items)).toBe(true);
  });

  it('sends "Charged ID" ONLY for Charged', () => {
    const created = mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersCreate, ordersCreatePayload);
    expect(created?.records[0]?.evtData).not.toHaveProperty('Charged ID');
    expect(created?.records[0]?.evtData).toHaveProperty('Order ID', ORDER_ID);
  });

  it('maps line items with id / name / qty / price', () => {
    const items = evtData.Items as Record<string, unknown>[];
    expect(items[0]).toMatchObject({
      'Product ID': '10155084972338',
      'Product name': 'Cotton T-Shirt',
      Quantity: 2,
      Price: 600,
      SKU: 'TSHIRT-M-BLUE',
    });
  });

  it('sums quantities into Items Count', () => {
    expect(evtData['Items Count']).toBe(2);
  });

  it('carries the order number and both statuses', () => {
    expect(evtData['Order Number']).toBe('1001');
    expect(evtData['Payment Status']).toBe('paid');
    expect(evtData['Fulfilment Status']).toBe('unfulfilled');
  });

  it('is an event record with the normalised phone as CleverTap Identity', () => {
    expect(record?.type).toBe('event');
    expect(record?.identity).toBe(ORDER_EXPECTED_IDENTITY);
  });

  it('back-dates the event with a unix-seconds ts read from the UTC timestamp', () => {
    expect(record?.ts).toBe(Math.floor(Date.parse(ORDER_UPDATED_AT) / 1000));
    expect(ORDER_UPDATED_AT.endsWith('Z')).toBe(true);
  });
});

describe('mapOrderEvent — degraded payloads', () => {
  it('missing line items yield an empty Items[] and never throw', () => {
    const mapped = mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, orderWithoutLineItemsPayload);
    expect(mapped?.records[0]?.evtData?.Items).toEqual([]);
    expect(mapped?.records[0]?.evtData?.Amount).toBe(100);
  });

  it.each([
    [],
    null,
    undefined,
    'nope',
    42,
    {},
  ])('tolerates line_items = %s without throwing', (lineItems) => {
    const mapped = mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, {
      ...ordersPaidPayload,
      line_items: lineItems,
    });
    expect(mapped?.records[0]?.evtData?.Items).toEqual([]);
  });

  it('defaults a missing/zero line-item quantity to 1', () => {
    const mapped = mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, {
      ...ordersPaidPayload,
      line_items: [
        { id: 'li', title: 'Thing' },
        { id: 'li2', title: 'Other', quantity: 0 },
      ],
    });
    const items = mapped?.records[0]?.evtData?.Items as Record<string, unknown>[];
    expect(items.map((i) => i.Quantity)).toEqual([1, 1]);
  });

  it('handles a zero / absent discount as 0', () => {
    expect(
      mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, orderWithoutLineItemsPayload)?.records[0]
        ?.evtData?.Discount,
    ).toBe(0);
  });

  it('tolerates the documented null customer / shipping_address / billing_address', () => {
    const mapped = mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, ordersPaidPayload);
    expect(mapped).not.toBeNull();
    expect(JSON.stringify(mapped)).not.toContain('null');
  });

  it('returns null when there is no order id — nothing to key idempotency on', () => {
    expect(mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, orderWithoutIdPayload)).toBeNull();
    expect(mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, {})).toBeNull();
  });

  it('stringifies a numeric order id', () => {
    const mapped = mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, {
      ...ordersPaidPayload,
      id: 90210,
    });
    expect(mapped?.subjectId).toBe('90210');
  });
});

describe('mapOrderEvent — the 256-item cap', () => {
  const orderWithLines = (n: number) => ({
    ...ordersPaidPayload,
    line_items: Array.from({ length: n }, (_, i) => ({
      id: `li_${i}`,
      title: `Item ${i}`,
      quantity: 1,
      price: '100.00',
    })),
  });

  const itemsOf = (order: Record<string, unknown>) =>
    mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, order)?.records[0]?.evtData?.Items as
      | Record<string, unknown>[]
      | undefined;

  it("is set to CleverTap's documented ceiling of 256", () => {
    expect(CLEVERTAP_MAX_ITEMS).toBe(256);
  });

  it('passes exactly 256 items through untruncated', () => {
    expect(itemsOf(orderWithLines(CLEVERTAP_MAX_ITEMS))).toHaveLength(CLEVERTAP_MAX_ITEMS);
  });

  it('truncates 300 items to 256 rather than risking the whole event', () => {
    expect(itemsOf(orderWithLines(300))).toHaveLength(CLEVERTAP_MAX_ITEMS);
  });

  it('keeps the TRUE basket size in Items Count when Items is truncated', () => {
    const mapped = mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, orderWithLines(300));
    expect(mapped?.records[0]?.evtData?.['Items Count']).toBe(300);
    expect(mapped?.records[0]?.evtData?.Items).toHaveLength(256);
  });

  it('truncates from the FRONT — the first 256 lines are the ones kept', () => {
    const items = itemsOf(orderWithLines(300)) ?? [];
    expect(items[0]?.['Product ID']).toBe('li_0');
    expect(items.at(-1)?.['Product ID']).toBe('li_255');
  });

  it('leaves a normal order completely untouched', () => {
    const mapped = mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, ordersPaidPayload);
    expect(mapped?.records[0]?.evtData?.Items).toHaveLength(1);
    expect(mapped?.records[0]?.evtData?.['Items Count']).toBe(2);
  });
});

describe('mapOrderEvent — Payment mode (CleverTap reserved property)', () => {
  const paymentModeFor = (order: Record<string, unknown>) =>
    mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, order)?.records[0]?.evtData?.[
      'Payment mode'
    ];

  it("reads the official payload's payment_gateway_names array", () => {
    expect(officialOrderPayload.payment_gateway_names).toEqual(['razorpay']);
    expect(paymentModeFor(ordersPaidPayload)).toBe('razorpay');
  });

  it('sends the reserved lowercase-m "Payment mode" spelling', () => {
    const evtData =
      mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, ordersPaidPayload)?.records[0]?.evtData ??
      {};
    expect(evtData).toHaveProperty('Payment mode', 'razorpay');
    expect(evtData).not.toHaveProperty('Payment Mode');
  });

  it('keeps the custom Payment Status alongside it', () => {
    const evtData =
      mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, ordersPaidPayload)?.records[0]?.evtData ??
      {};
    expect(evtData['Payment Status']).toBe('paid');
    expect(evtData['Payment mode']).toBe('razorpay');
  });

  it.each([
    ['payment_gateway_names', { payment_gateway_names: ['razorpay'] }],
    ['payment_gateway', { payment_gateway: 'razorpay' }],
    ['gateway', { gateway: 'payu' }],
    ['payment_method', { payment_method: 'upi' }],
    ['a multi-gateway array (split payment)', { payment_gateway_names: ['cod', 'razorpay'] }],
  ])('derives it defensively from %s', (_label, fields) => {
    expect(paymentModeFor({ ...ordersPaidPayload, ...fields })).toBeTruthy();
  });

  it('OMITS the key when the payload carries no payment field at all', () => {
    expect(paymentModeFor(orderWithoutLineItemsPayload)).toBeUndefined();
    expect(
      mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, orderWithoutLineItemsPayload)?.records[0]
        ?.evtData,
    ).not.toHaveProperty('Payment mode');
  });
});

describe('mapOrderEvent — Items is the ONLY nested evtData value', () => {
  const payloads: [string, Record<string, unknown>][] = [
    ['orders/paid', ordersPaidPayload],
    ['orders/create', ordersCreatePayload],
    ['orders/updated', ordersUpdatedPayload],
    ['orders/cancelled', ordersCancelledPayload],
    ['orders/delete', ordersDeletePayload],
    ['no line items', orderWithoutLineItemsPayload],
    ['customer_id only', orderWithCustomerIdOnlyPayload],
  ];

  const orderTopics = ORDER_TOPIC_CASES.map((c) => c.topic);

  it.each(payloads)('every non-Items value is a scalar for %s', (_label, payload) => {
    for (const topic of orderTopics) {
      const evtData = mapOrderEvent(topic, payload)?.records[0]?.evtData ?? {};
      for (const [key, value] of Object.entries(evtData)) {
        if (key === 'Items') continue;
        expect(typeof value === 'object' && value !== null).toBe(false);
      }
    }
  });

  it("never leaks the payload's own nested objects (price_set, addresses)", () => {
    const evtData =
      mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, ordersPaidPayload)?.records[0]?.evtData ??
      {};
    expect(Object.keys(evtData)).not.toContain('total_price_set');
    expect(JSON.stringify(evtData)).not.toContain('shop_money');
    expect(JSON.stringify(evtData)).not.toContain('shopMoney');
  });

  it('drops a nested value that reaches evtData anyway (512 backstop)', () => {
    const mapped = mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, {
      ...ordersPaidPayload,
      currency: { code: 'INR' } as unknown as string,
      order_number: { n: 1 } as unknown as number,
    });
    const evtData = mapped?.records[0]?.evtData ?? {};
    for (const [key, value] of Object.entries(evtData)) {
      if (key === 'Items') continue;
      expect(Array.isArray(value)).toBe(false);
      expect(value === null || typeof value !== 'object').toBe(true);
    }
  });

  it('keeps Items[] itself nested — it is the documented exception', () => {
    const evtData =
      mapOrderEvent(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, ordersPaidPayload)?.records[0]?.evtData ??
      {};
    expect(Array.isArray(evtData.Items)).toBe(true);
    expect((evtData.Items as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('mapCustomerProfile', () => {
  it('maps customers/create to a Customer Created profile record', () => {
    const mapped = mapCustomerProfile(
      CLEVERTAP_WEBHOOK_TOPICS.customersCreate,
      customersCreatePayload,
    );
    expect(mapped?.clevertapEvent).toBe('Customer Created');
    expect(mapped?.records[0]?.type).toBe('profile');
    expect(mapped?.records[0]?.profileData).toMatchObject({
      Phone: '+919876543210',
      Email: 'priya@example.com',
      Name: 'Priya Sharma',
    });
  });

  it('puts Identity at the TOP LEVEL only, never inside profileData', () => {
    const mapped = mapCustomerProfile(
      CLEVERTAP_WEBHOOK_TOPICS.customersCreate,
      customersCreatePayload,
    );
    expect(mapped?.records[0]?.identity).toBe('+919876543210');
    expect(mapped?.records[0]?.profileData).not.toHaveProperty('Identity');
    expect(Object.keys(mapped?.records[0]?.profileData ?? {})).not.toContain('Identity');
  });

  it('maps customers/update including BOTH consent flags', () => {
    const mapped = mapCustomerProfile(
      CLEVERTAP_WEBHOOK_TOPICS.customersUpdate,
      customersUpdatePayload,
    );
    expect(mapped?.clevertapEvent).toBe('Customer Updated');
    expect(mapped?.records[0]?.profileData).toMatchObject({
      'MSG-email': true,
      'MSG-sms': false,
    });
  });

  it('accepts the string consent encoding too', () => {
    const mapped = mapCustomerProfile(
      CLEVERTAP_WEBHOOK_TOPICS.customersUpdate,
      customersUpdateStringConsentPayload,
    );
    expect(mapped?.records[0]?.profileData).toMatchObject({
      'MSG-email': true,
      'MSG-sms': false,
    });
  });

  it('OMITS an absent consent flag rather than sending false (compliance)', () => {
    const mapped = mapCustomerProfile(
      CLEVERTAP_WEBHOOK_TOPICS.customersCreate,
      customersCreatePayload,
    );
    expect(mapped?.records[0]?.profileData).not.toHaveProperty('MSG-email');
    expect(mapped?.records[0]?.profileData).not.toHaveProperty('MSG-sms');
  });

  it('returns null when the customer has no phone and no email', () => {
    expect(
      mapCustomerProfile(CLEVERTAP_WEBHOOK_TOPICS.customersCreate, customerWithoutContactPayload),
    ).toBeNull();
  });

  it('returns null when there is no customer id', () => {
    expect(
      mapCustomerProfile(CLEVERTAP_WEBHOOK_TOPICS.customersUpdate, customerWithoutIdPayload),
    ).toBeNull();
  });
});

describe('buildIdempotencyKey', () => {
  it('is `<event_type>:<resource id>` (A9)', () => {
    expect(buildIdempotencyKey('orders/paid', ORDER_ID)).toBe(`orders/paid:${ORDER_ID}`);
  });

  it('separates the two order topics for the same order, so both can forward', () => {
    expect(buildIdempotencyKey('orders/paid', 'ord_1')).not.toBe(
      buildIdempotencyKey('orders/create', 'ord_1'),
    );
  });
});
