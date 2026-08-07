import {
  CLEVERTAP_CHARGED_EVENT,
  CLEVERTAP_WEBHOOK_EVENT_NAMES,
} from '@ratio-app/shared/constants/clevertap-events';
import type { ClevertapCustomerTopic } from '../webhooks/topics';

export const CLEVERTAP_MAX_ITEMS = 256;

const CLEVERTAP_NESTABLE_EVT_KEY = 'Items';

export const CLEVERTAP_CUSTOMER_EVENT_NAMES = {
  'customers/create': 'Customer Created',
  'customers/update': 'Customer Updated',
} as const satisfies Record<ClevertapCustomerTopic, string>;

export interface ClevertapUploadRecord {
  identity?: string;
  type: 'event' | 'profile';
  evtName?: string;
  evtData?: Record<string, unknown>;
  profileData?: Record<string, unknown>;
  ts?: number;
}

export interface MappedClevertapEvent {
  clevertapEvent: string;
  subjectId: string;
  records: ClevertapUploadRecord[];
}

export function parseRupees(value: unknown): number {
  const rupees = toFiniteNumber(value);
  if (rupees === null) return 0;
  return Math.round(rupees * 100) / 100;
}

function moneyFrom(scalar: unknown, moneySet: unknown): number {
  if (toFiniteNumber(scalar) !== null) return parseRupees(scalar);
  const set = asRecord(moneySet);
  for (const money of [
    set.shop_money,
    set.shopMoney,
    set.presentment_money,
    set.presentmentMoney,
  ]) {
    const amount = asRecord(money).amount;
    if (toFiniteNumber(amount) !== null) return parseRupees(amount);
  }
  return 0;
}

export function normalizeIndianPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(cleaned)) return null;

  let digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91${digits}`;
}

export function mapOrderEvent(
  topic: string,
  order: Record<string, unknown>,
): MappedClevertapEvent | null {
  const orderId = extractId(order);
  if (!orderId) return null;

  const identity = deriveOrderIdentity(order);
  if (!identity) return null;

  const clevertapEvent = deriveOrderEventName(topic);
  const { items, totalQuantity } = mapLineItems(order.line_items);

  const evtData: Record<string, unknown> = {
    'Order ID': orderId,
    Amount: moneyFrom(order.total_price, order.total_price_set),
    Currency: typeof order.currency === 'string' && order.currency ? order.currency : 'INR',
    Discount: moneyFrom(order.total_discounts, order.total_discounts_set),
    'Items Count': totalQuantity,
    Items: items,
  };
  if (clevertapEvent === CLEVERTAP_CHARGED_EVENT) evtData['Charged ID'] = orderId;
  if (typeof order.order_number === 'number' || typeof order.order_number === 'string') {
    evtData['Order Number'] = order.order_number;
  }
  if (typeof order.financial_status === 'string' && order.financial_status) {
    evtData['Payment Status'] = order.financial_status;
  }
  const paymentMode = derivePaymentMode(order);
  if (paymentMode) evtData['Payment mode'] = paymentMode;

  const pay = asRecord(order.payment_details);
  const paymentMethod = firstString(pay.paymentMethod);
  if (paymentMethod) evtData['Payment Method'] = paymentMethod;
  const paymentInstrument = firstString(pay.paymentInstrument);
  if (paymentInstrument) evtData['Payment Instrument'] = paymentInstrument;
  const paymentId = firstString(pay.paymentId);
  if (paymentId) evtData['Payment Id'] = paymentId;
  const pgTxnId = firstString(pay.pgPaymentTrnxId);
  if (pgTxnId) evtData['PG Transaction Id'] = pgTxnId;

  if (typeof order.fulfillment_status === 'string' && order.fulfillment_status) {
    evtData['Fulfilment Status'] = order.fulfillment_status;
  }

  enforceFlatEvtData(evtData);

  const ts = toUnixSeconds(order.updated_at ?? order.created_at);

  return {
    clevertapEvent,
    subjectId: orderId,
    records: [
      {
        identity,
        type: 'event',
        evtName: clevertapEvent,
        evtData,
        ...(ts !== null ? { ts } : {}),
      },
    ],
  };
}

export function mapCustomerProfile(
  topic: ClevertapCustomerTopic,
  customer: Record<string, unknown>,
): MappedClevertapEvent | null {
  const customerId = extractId(customer);
  const identity = deriveIdentity(customer);
  if (!customerId || !identity) return null;

  const phone = normalizeIndianPhone(customer.phone);
  const email = extractEmail(customer);
  const name = extractName(customer);
  const emailConsent = toOptionalBoolean(customer.email_marketing_consent);
  const smsConsent = toOptionalBoolean(customer.sms_marketing_consent);

  const profileData: Record<string, unknown> = {
    ...(phone ? { Phone: phone } : {}),
    ...(email ? { Email: email } : {}),
    ...(name ? { Name: name } : {}),
    ...(emailConsent !== null ? { 'MSG-email': emailConsent } : {}),
    ...(smsConsent !== null ? { 'MSG-sms': smsConsent } : {}),
    'Ratio Customer ID': customerId,
  };

  const ts = toUnixSeconds(customer.updated_at ?? customer.created_at);

  return {
    clevertapEvent: CLEVERTAP_CUSTOMER_EVENT_NAMES[topic],
    subjectId: customerId,
    records: [
      {
        identity,
        type: 'profile',
        profileData,
        ...(ts !== null ? { ts } : {}),
      },
    ],
  };
}

const UNHANDLED_ORDER_EVENT_NAMES: Record<string, string> = {
  'orders/edited': 'Order Edited',
  'orders/delete': 'Order Deleted',
};

export function deriveOrderEventName(topic: string): string {
  const known = (CLEVERTAP_WEBHOOK_EVENT_NAMES as Record<string, string | undefined>)[topic];
  if (known) return known;
  const mapped = UNHANDLED_ORDER_EVENT_NAMES[topic];
  if (mapped) return mapped;
  const suffix = topic.startsWith('orders/') ? topic.slice('orders/'.length) : topic;
  const words = suffix
    .split(/[_\-/]+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1));
  return words.length > 0 ? `Order ${words.join(' ')}` : 'Order Updated';
}

export interface UnmappableOrder {
  subjectId: string | null;
  reason: string;
}

export const ORDER_UNMAPPABLE_NO_ID = 'payload has no order id';

export const ORDER_UNMAPPABLE_NO_IDENTITY =
  'payload has no phone, email or customer id — CleverTap requires an identity (523)';

export function describeUnmappableOrder(order: Record<string, unknown>): UnmappableOrder {
  const subjectId = extractId(order);
  return {
    subjectId,
    reason: subjectId === null ? ORDER_UNMAPPABLE_NO_ID : ORDER_UNMAPPABLE_NO_IDENTITY,
  };
}

export function buildIdempotencyKey(topic: string, subjectId: string): string {
  return `${topic}:${subjectId}`;
}

interface ClevertapItem extends Record<string, unknown> {
  Quantity: number;
}

interface MappedLineItems {
  items: ClevertapItem[];
  totalQuantity: number;
}

function mapLineItems(lineItems: unknown): MappedLineItems {
  if (!Array.isArray(lineItems)) return { items: [], totalQuantity: 0 };
  const items: ClevertapItem[] = [];
  let totalQuantity = 0;
  for (const raw of lineItems) {
    const item = asRecord(raw);
    const qty = toFiniteNumber(item.quantity);
    const quantity = qty !== null && qty > 0 ? Math.round(qty) : 1;
    totalQuantity += quantity;
    if (items.length >= CLEVERTAP_MAX_ITEMS) continue;
    const productId = firstString(item.product_id, item.variant_id, item.id);
    const title = firstString(item.title, item.name, item.product_title);
    items.push({
      ...(productId ? { 'Product ID': productId } : {}),
      ...(title ? { 'Product name': title } : {}),
      Quantity: quantity,
      Price: moneyFrom(item.price, item.price_set),
      ...(firstString(item.sku) ? { SKU: firstString(item.sku) } : {}),
      ...(firstString(item.product_type) ? { Category: firstString(item.product_type) } : {}),
    });
  }
  return { items, totalQuantity };
}

function derivePaymentMode(order: Record<string, unknown>): string | null {
  for (const candidate of [
    order.payment_gateway_names,
    order.payment_gateway,
    order.gateway,
    order.payment_method,
  ]) {
    const value = Array.isArray(candidate) ? firstString(...candidate) : firstString(candidate);
    if (value) return value;
  }
  return null;
}

function enforceFlatEvtData(evtData: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(evtData)) {
    if (key === CLEVERTAP_NESTABLE_EVT_KEY) continue;
    if (value !== null && typeof value === 'object') delete evtData[key];
  }
  return evtData;
}

function deriveIdentity(customer: Record<string, unknown>): string | null {
  return normalizeIndianPhone(customer.phone) ?? extractEmail(customer);
}

function deriveOrderIdentity(order: Record<string, unknown>): string | null {
  const customer = asRecord(order.customer);
  return (
    normalizeIndianPhone(order.phone) ??
    normalizeIndianPhone(customer.phone) ??
    extractEmail(order) ??
    extractEmail(customer) ??
    firstString(order.customer_id) ??
    firstString(customer.id)
  );
}

function extractId(resource: Record<string, unknown>): string | null {
  return firstString(resource.id);
}

function extractEmail(customer: Record<string, unknown>): string | null {
  const email = typeof customer.email === 'string' ? customer.email.trim() : '';
  return email ? email.toLowerCase() : null;
}

function extractName(customer: Record<string, unknown>): string | null {
  const first = typeof customer.first_name === 'string' ? customer.first_name.trim() : '';
  const last = typeof customer.last_name === 'string' ? customer.last_name.trim() : '';
  const full = [first, last].filter(Boolean).join(' ');
  if (full) return full;
  const single = typeof customer.name === 'string' ? customer.name.trim() : '';
  return single || null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function firstString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '') return c.trim();
    if (typeof c === 'number' && Number.isFinite(c)) return String(c);
  }
  return null;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toOptionalBoolean(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'subscribed' || s === 'true' || s === 'yes') return true;
    if (s === 'not_subscribed' || s === 'unsubscribed' || s === 'false' || s === 'no') return false;
  }
  return null;
}

function toUnixSeconds(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.floor(v > 1e11 ? v / 1000 : v);
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
  }
  return null;
}
