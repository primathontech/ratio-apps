import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

// Strict calendar date: YYYY-MM-DD only, and a real day. Mirrors the tightened
// server validator (the native <input type="date"> already emits this shape),
// so the widget rejects the same values the server now rejects — "2026",
// "July 2026", "12/31/2026", and impossible dates like "2026-02-30" (which
// Date.parse would silently roll over). UX only; the server stays authoritative.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateDate(field: ControlFieldOf<'date'>, ctx: FieldValidateCtx): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'this field is required' : null;
  const raw = String(value);
  if (!ISO_DATE_RE.test(raw)) return 'must be a date in YYYY-MM-DD format';
  // Round-trip through UTC to reject impossible calendar dates (no rollover).
  // The regex guarantees fixed offsets, so the slices are safe to parse.
  const y = Number(raw.slice(0, 4));
  const mo = Number(raw.slice(5, 7));
  const d = Number(raw.slice(8, 10));
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return 'must be a valid date';
  }
  return null;
}
