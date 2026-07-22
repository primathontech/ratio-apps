import type { FieldOfType, ServerValidateResult } from '../types';

/** Strict calendar-date shape: 4-digit year, 2-digit month, 2-digit day. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * date: require a strict ISO `YYYY-MM-DD` and a real calendar date, then store
 * the canonical ISO string (P2-5). `Date.parse` is far too lax — it accepts
 * "2026", "July 2026", and "12/31/2026", and rolls "2026-02-30" over to March,
 * all of which then round-trip verbatim into data_json / CSV / webhook.
 */
export function validateDate(_field: FieldOfType<'date'>, value: unknown): ServerValidateResult {
  if (typeof value !== 'string') return { error: 'must be a date in YYYY-MM-DD format' };
  const m = ISO_DATE.exec(value.trim());
  if (!m) return { error: 'must be a date in YYYY-MM-DD format' };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // Reject impossible dates (month 00/13, day 00, 2026-02-30) by round-tripping
  // through a UTC date and checking the components survive unchanged.
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return { error: 'must be a valid calendar date' };
  }
  return { value: `${m[1]}-${m[2]}-${m[3]}` };
}
