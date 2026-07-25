import type { FieldOfType, ServerValidateResult } from '../types';

type NumberFormat = NonNullable<FieldOfType<'number'>['format']>;

/**
 * The decimal separator a locale uses (`.` for en-*, `,` for de-DE/fr-FR).
 * Derived from `Intl` (Node ships full ICU) so we can strip a display-formatted
 * string back to a canonical JS number regardless of the merchant's locale.
 * Falls back to `.` if the locale is somehow unknown.
 */
function decimalSeparatorFor(locale: string): string {
  try {
    return (
      new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal')?.value ??
      '.'
    );
  } catch {
    return '.';
  }
}

/**
 * Strip a display-formatted numeric string (grouping separators, currency
 * symbol, `%`, whitespace) down to a canonical number. Keeps digits, a single
 * leading minus, and the locale's decimal separator (normalized to `.`).
 * Returns null when nothing numeric remains.
 */
function normalizeFormatted(raw: string, decimalSep: string): number | null {
  let out = '';
  for (const ch of raw.trim()) {
    if (ch >= '0' && ch <= '9') out += ch;
    else if (ch === '-' && out === '') out += '-';
    else if (ch === decimalSep && !out.includes('.')) out += '.';
    // everything else (group separator, currency symbol, %, spaces) is dropped
  }
  if (out === '' || out === '-' || out === '.' || out === '-.') return null;
  const n = Number(out);
  return Number.isFinite(n) ? n : null;
}

/**
 * Coerce a submitted value to a canonical number. A plain number passes
 * through; a string is parsed directly first (preserving `1e3`, whitespace,
 * etc. — today's behavior), and only falls back to locale-aware separator
 * stripping when a direct parse fails (e.g. a client that bypassed the SDK and
 * POSTed `"1,234.50"`). SERVER-AUTHORITATIVE: the canonical number is what we
 * store, never the formatted string.
 */
function coerceNumber(value: unknown, format: NumberFormat | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const direct = Number(trimmed);
  if (trimmed !== '' && Number.isFinite(direct)) return direct;
  return normalizeFormatted(value, decimalSeparatorFor(format?.locale ?? 'en-US'));
}

export function validateNumber(field: FieldOfType<'number'>, value: unknown): ServerValidateResult {
  let num = coerceNumber(value, field.format);
  if (num === null) {
    return { error: 'Please enter a number.' };
  }
  // Display formatting is server-authoritative for precision: round the
  // canonical value to the configured decimal places so the stored number
  // matches what the shopper saw, regardless of client behavior.
  if (field.format?.decimalPlaces !== undefined) {
    const factor = 10 ** field.format.decimalPlaces;
    num = Math.round(num * factor) / factor;
  }
  const v = field.validation;
  if (v?.integer && !Number.isInteger(num)) {
    return { error: 'Please enter a whole number.' };
  }
  if (v?.min !== undefined && num < v.min) {
    return { error: `Please enter a value of ${v.min} or more.` };
  }
  if (v?.max !== undefined && num > v.max) {
    return { error: `Please enter a value of ${v.max} or less.` };
  }
  // step must be enforced server-side too (P2-4): value must be a whole number
  // of steps from the base (min, or 0 when unset), matching the client check.
  if (v?.step !== undefined && v.step > 0) {
    const base = v.min ?? 0;
    const steps = (num - base) / v.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-9) {
      return { error: `Please enter a multiple of ${v.step}.` };
    }
  }
  return { value: num };
}
