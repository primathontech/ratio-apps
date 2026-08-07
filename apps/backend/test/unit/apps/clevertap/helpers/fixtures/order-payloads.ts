export interface OrderPayload extends Record<string, unknown> {
  id: string;
  event_type: string;
  total_price: string;
  line_items: Record<string, unknown>[];
}

export const ORDER_ID = 'ordr_17810776574055715';

export const ORDER_TOTAL_RUPEES = 1200;

export const LINE_ITEM_PRICE_RUPEES = 600;

export const ORDER_TOP_LEVEL_PHONE = '+919800000000';

export const ORDER_EXPECTED_IDENTITY = ORDER_TOP_LEVEL_PHONE;

export const ORDER_TOP_LEVEL_EMAIL = 'buyer@example.com';

export const ORDER_UPDATED_AT = '2026-06-10T08:30:05.000Z';

export const officialOrderPayload: OrderPayload = {
  id: ORDER_ID,
  name: '#1001',
  order_number: '1001',
  currency: 'INR',
  presentment_currency: 'INR',
  financial_status: 'paid',
  fulfillment_status: 'unfulfilled',
  status: 'open',
  confirmed: true,
  test: false,
  email: ORDER_TOP_LEVEL_EMAIL,
  phone: ORDER_TOP_LEVEL_PHONE,
  note: null,
  tags: '',
  subtotal_price: '1200.00',
  total_discounts: '0.00',
  total_tax: '0.00',
  total_line_items_price: '1200.00',
  total_outstanding: '0.00',
  total_price: '1200.00',
  total_price_set: {
    shop_money: { amount: '1200.00', currencyCode: 'INR' },
    presentment_money: { amount: '1200.00', currencyCode: 'INR' },
  },
  payment_gateway_names: ['razorpay'],
  discount_codes: [],
  customer: null,
  customer_id: null,
  billing_address: null,
  shipping_address: null,
  line_items: [
    {
      id: '561',
      product_id: '10155084972338',
      variant_id: '51055089484082',
      title: 'Cotton T-Shirt',
      variant_title: 'M / Blue',
      sku: 'TSHIRT-M-BLUE',
      quantity: 2,
      current_quantity: 2,
      fulfillable_quantity: 2,
      price: '600.00',
      price_set: {
        shopMoney: { amount: '600.00', currencyCode: 'INR' },
        presentmentMoney: { amount: '600.00', currencyCode: 'INR' },
      },
      total_discount: 0,
      taxable: true,
      fulfillment_status: 'unfulfilled',
    },
  ],
  fulfillments: [],
  refunds: [],
  created_at: '2026-06-10T08:30:00.000Z',
  updated_at: ORDER_UPDATED_AT,
  processed_at: '2026-06-10T08:30:00.000Z',
  event_type: 'orders/create',
  merchant_id: '19ix7n5l3mk6',
};

export const ordersCreatePayload: OrderPayload = {
  ...officialOrderPayload,
  event_type: 'orders/create',
  financial_status: 'pending',
  fulfillment_status: 'unfulfilled',
  status: 'open',
};

export const ordersPaidPayload: OrderPayload = {
  ...officialOrderPayload,
  event_type: 'orders/paid',
  financial_status: 'paid',
};

export const ordersUpdatedPayload: OrderPayload = {
  ...officialOrderPayload,
  event_type: 'orders/updated',
};

export const ordersFulfilledPayload: OrderPayload = {
  ...officialOrderPayload,
  event_type: 'orders/fulfilled',
  fulfillment_status: 'fulfilled',
};

export const ordersPartiallyFulfilledPayload: OrderPayload = {
  ...officialOrderPayload,
  event_type: 'orders/partially_fulfilled',
  fulfillment_status: 'partial',
};

export const ordersCancelledPayload: OrderPayload = {
  ...officialOrderPayload,
  event_type: 'orders/cancelled',
  financial_status: 'refunded',
  fulfillment_status: null,
  status: 'cancelled',
  cancelled_at: '2026-06-11T04:00:00.000Z',
  cancel_reason: 'customer',
};

export const ordersEditedPayload: OrderPayload = {
  ...officialOrderPayload,
  event_type: 'orders/edited',
};

export const ordersDeletePayload: OrderPayload = {
  ...officialOrderPayload,
  event_type: 'orders/delete',
  status: 'cancelled',
  deleted_at: '2026-06-12T06:00:00.000Z',
};

export const ORDER_TOPIC_CASES: readonly {
  topic: string;
  event: string;
  handled: boolean;
  payload: OrderPayload;
}[] = [
  { topic: 'orders/create', event: 'Order Created', handled: true, payload: ordersCreatePayload },
  { topic: 'orders/updated', event: 'Order Updated', handled: true, payload: ordersUpdatedPayload },
  { topic: 'orders/paid', event: 'Charged', handled: true, payload: ordersPaidPayload },
  {
    topic: 'orders/fulfilled',
    event: 'Order Fulfilled',
    handled: true,
    payload: ordersFulfilledPayload,
  },
  {
    topic: 'orders/partially_fulfilled',
    event: 'Order Partially Fulfilled',
    handled: true,
    payload: ordersPartiallyFulfilledPayload,
  },
  {
    topic: 'orders/cancelled',
    event: 'Order Cancelled',
    handled: true,
    payload: ordersCancelledPayload,
  },
  { topic: 'orders/edited', event: 'Order Edited', handled: false, payload: ordersEditedPayload },
  { topic: 'orders/delete', event: 'Order Deleted', handled: false, payload: ordersDeletePayload },
];

export const orderWithCustomerObjectPayload: Record<string, unknown> = {
  ...officialOrderPayload,
  phone: null,
  customer: {
    id: 'cust_501',
    phone: '9876543210',
    email: 'Priya@Example.com',
    first_name: 'Priya',
    last_name: 'Sharma',
  },
};

export const orderWithEmailOnlyPayload: Record<string, unknown> = {
  ...officialOrderPayload,
  phone: null,
  email: 'Buyer@Example.COM',
  customer: null,
};

export const orderWithCustomerEmailOnlyPayload: Record<string, unknown> = {
  ...officialOrderPayload,
  phone: 'not-a-phone',
  email: '',
  customer: { id: 'cust_777', phone: '+1 415 555 0100', email: 'Fallback@Example.com' },
};

export const orderWithCustomerIdOnlyPayload: Record<string, unknown> = {
  ...officialOrderPayload,
  phone: null,
  email: null,
  customer: null,
  customer_id: 'cust_9001',
};

export const orderWithNestedCustomerIdOnlyPayload: Record<string, unknown> = {
  ...officialOrderPayload,
  phone: null,
  email: null,
  customer_id: null,
  customer: { id: 'cust_nested_42', phone: null, email: null },
};

export const orderWithoutIdentityPayload: Record<string, unknown> = {
  ...officialOrderPayload,
  phone: null,
  email: null,
  customer: null,
  customer_id: null,
};

export const orderWithoutLineItemsPayload: Record<string, unknown> = {
  id: 'ordr_2002',
  total_price: '100.00',
  phone: '+919812345678',
};

export const orderWithoutIdPayload: Record<string, unknown> = {
  total_price: '100.00',
  phone: '9876543210',
};

export const MONEY_CASES: readonly {
  label: string;
  raw: number | string;
  rupees: number;
}[] = [
  { label: 'the official total as a decimal string', raw: '1200.00', rupees: 1200 },
  { label: 'the official total as a number', raw: 1200, rupees: 1200 },
  { label: 'the official line-item price', raw: '600.00', rupees: 600 },
  { label: 'zero as a decimal string', raw: '0.00', rupees: 0 },
  { label: 'zero as a number', raw: 0, rupees: 0 },
  { label: 'a rupees-and-paise decimal', raw: '499.50', rupees: 499.5 },
  { label: 'a one-paisa decimal', raw: '0.01', rupees: 0.01 },
  { label: 'a lakh-scale total', raw: '155900.00', rupees: 155_900 },
  { label: 'an integer-valued string', raw: '1559', rupees: 1559 },
  { label: 'a float', raw: 499.5, rupees: 499.5 },
];
