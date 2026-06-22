import { createHash } from 'node:crypto';
import type { RawCapiEvent } from './capi.service';

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}
const isHashed = (v: string): boolean => /^[a-f0-9]{64}$/i.test(v);
const normEmail = (v: string): string => v.trim().toLowerCase();
const normPhone = (v: string): string => {
  const d = v.replace(/\D/g, '');
  return d.length === 10 ? `91${d}` : d;
};
const normName = (v: string): string => v.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const hashWith = (v: string, n: (s: string) => string): string => (isHashed(v) ? v.toLowerCase() : sha256(n(v)));

/** Hash PII in user_data at the EDGE so raw PII never reaches the bus. Idempotent. */
export function hashEventPii(e: RawCapiEvent): RawCapiEvent {
  const u = e.user_data;
  if (!u) return { ...e };
  const out: NonNullable<RawCapiEvent['user_data']> = { ...u };
  if (u.em) out.em = hashWith(u.em, normEmail);
  if (u.ph) out.ph = hashWith(u.ph, normPhone);
  if (u.fn) out.fn = hashWith(u.fn, normName);
  if (u.ln) out.ln = hashWith(u.ln, normName);
  if (u.external_id) out.external_id = hashWith(u.external_id, (v) => v.trim());
  return { ...e, user_data: out };
}

/** Parse "merchantA:8,merchantB:4" → Map(merchantId → bucketCount). */
export function parseWhaleBuckets(raw: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [id, n] = part.split(':');
    const b = Number(n);
    if (id && Number.isInteger(b) && b > 1) m.set(id, b);
  }
  return m;
}

/** Partition key: bare merchantId, or merchantId#<bucket> for configured whales. */
export function partitionKey(
  merchantId: string,
  eventId: string | undefined,
  buckets: Map<string, number>,
): string {
  const b = buckets.get(merchantId) ?? 1;
  if (b <= 1) return merchantId;
  const h = createHash('sha256').update(eventId ?? '').digest();
  return `${merchantId}#${h.readUInt32BE(0) % b}`;
}
