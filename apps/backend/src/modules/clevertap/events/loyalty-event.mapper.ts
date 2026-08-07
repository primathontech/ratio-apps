import { CLEVERTAP_WEBHOOK_EVENT_NAMES } from '@ratio-app/shared/constants/clevertap-events';
import { type MappedClevertapEvent, normalizeIndianPhone } from './order-event.mapper';

const LOYALTY_EVENT_NAME_FALLBACK: Record<string, string> = {
  'loyalty/points_credited': 'Points Credited',
  'loyalty/points_debited': 'Points Debited',
};

function deriveLoyaltyEventName(topic: string): string {
  const known = (CLEVERTAP_WEBHOOK_EVENT_NAMES as Record<string, string | undefined>)[topic];
  if (known) return known;
  const mapped = LOYALTY_EVENT_NAME_FALLBACK[topic];
  if (mapped) return mapped;
  const suffix = topic.includes('/') ? topic.slice(topic.indexOf('/') + 1) : topic;
  const words = suffix
    .split(/[_\-/]+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1));
  return words.length > 0 ? words.join(' ') : 'Loyalty Event';
}

export function mapLoyaltyEvent(
  topic: string,
  payload: Record<string, unknown>,
): MappedClevertapEvent | null {
  const identity = deriveLoyaltyIdentity(payload);
  if (!identity) return null;

  const subjectId = deriveLoyaltySubjectId(payload);
  if (!subjectId) return null;

  const clevertapEvent = deriveLoyaltyEventName(topic);

  const evtData: Record<string, unknown> = {};
  const points = firstNumber(payload.points, payload.points_delta, payload.delta, payload.amount);
  if (points !== null) evtData.Points = points;
  const balance = firstNumber(
    payload.balance,
    payload.points_balance,
    payload.current_balance,
    payload.new_balance,
    payload.total_points,
  );
  if (balance !== null) evtData.Balance = balance;
  const reason = firstString(
    payload.reason,
    payload.reason_code,
    payload.description,
    payload.event,
  );
  if (reason) evtData.Reason = reason;
  evtData['Transaction ID'] = subjectId;

  const ts = toUnixSeconds(payload.updated_at ?? payload.created_at ?? payload.timestamp);

  return {
    clevertapEvent,
    subjectId,
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

function deriveLoyaltyIdentity(payload: Record<string, unknown>): string | null {
  const customer = asRecord(payload.customer);
  const user = asRecord(payload.user);
  return (
    normalizeIndianPhone(payload.phone) ??
    normalizeIndianPhone(customer.phone) ??
    normalizeIndianPhone(user.phone) ??
    extractEmail(payload) ??
    extractEmail(customer) ??
    extractEmail(user) ??
    firstString(payload.customer_id, customer.id, user.id)
  );
}

function deriveLoyaltySubjectId(payload: Record<string, unknown>): string | null {
  return firstString(
    payload.id,
    payload.event_id,
    payload.transaction_id,
    payload.txn_id,
    payload.ledger_entry_id,
    payload.ledger_id,
    payload.reference_id,
    payload.reference,
  );
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function extractEmail(source: Record<string, unknown>): string | null {
  const email = typeof source.email === 'string' ? source.email.trim() : '';
  return email ? email.toLowerCase() : null;
}

function firstString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '') return c.trim();
    if (typeof c === 'number' && Number.isFinite(c)) return String(c);
  }
  return null;
}

function firstNumber(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    const n = toFiniteNumber(c);
    if (n !== null) return n;
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
