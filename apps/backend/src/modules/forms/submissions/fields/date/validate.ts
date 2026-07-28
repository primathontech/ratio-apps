import type { FieldOfType, ServerValidateResult } from '../types';

/** Strict calendar-date shape: 4-digit year, 2-digit month, 2-digit day. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Require strict ISO `YYYY-MM-DD` + a real calendar date, then store canonical ISO (P2-5); Date.parse is too lax (accepts "July 2026", rolls "2026-02-30" into March). */
export function validateDate(field: FieldOfType<'date'>, value: unknown): ServerValidateResult {
  if (typeof value !== 'string') return { error: 'Please enter a date in YYYY-MM-DD format.' };
  const m = ISO_DATE.exec(value.trim());
  if (!m) return { error: 'Please enter a date in YYYY-MM-DD format.' };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // Reject impossible dates by round-tripping through a UTC date and checking the components survive.
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return { error: 'Please enter a valid date.' };
  }
  const canonical = `${m[1]}-${m[2]}-${m[3]}`;
  // Re-check [min,max] server-side (client not authoritative); lexical compare is exact for canonical ISO.
  const v = field.validation;
  if (v?.min !== undefined && canonical < v.min) {
    return { error: `Please enter a date on or after ${v.min}.` };
  }
  if (v?.max !== undefined && canonical > v.max) {
    return { error: `Please enter a date on or before ${v.max}.` };
  }
  return { value: canonical };
}
