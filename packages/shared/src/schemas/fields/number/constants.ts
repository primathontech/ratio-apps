/**
 * Zod-free numeric canonicalization shared by the storefront SDK number field
 * (blur normalize + tolerant validate parse) and the backend submission
 * validator, so there is ONE locale-aware canonicalizer and client/server
 * verdicts never drift.
 *
 * Deliberately Zod-free — mirrors `form-adornments.ts`: the SDK imports these at
 * runtime and must not pull Zod into the widget bundle. No Intl *formatting*
 * lives here (that stays in the SDK's render.ts); this only DERIVES the locale
 * separators so a raw input can be reduced to a plain ASCII number.
 */

/** The subset of a number field's `format` the canonicalizer reads. Both the
 * SDK and server format types are structurally assignable to this. */
export interface NumberFormatLike {
  locale?: string | undefined;
  decimalPlaces?: number | undefined;
}

/**
 * Locale grouping + decimal separators, derived via `Intl.NumberFormat`
 * `formatToParts` so we strip exactly what the display produced (fr-FR groups
 * with U+202F, de-DE swaps the roles of '.' and ','). Any Intl failure falls
 * back to the ASCII pair.
 */
export function localeSeparators(locale: string | undefined): { group: string; decimal: string } {
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
    return {
      group: parts.find((p) => p.type === 'group')?.value ?? ',',
      decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
    };
  } catch {
    return { group: ',', decimal: '.' };
  }
}

/**
 * Reduce a grouped/locale-formatted string to plain ASCII: drop every grouping
 * separator (all whitespace, plus the locale's non-space group char) and map
 * the locale decimal separator to '.'. Blank ⇒ ''. Un-parseable text is left
 * as-is so the caller's `Number()` yields NaN and the validator flags it.
 */
function toAscii(raw: string, format: NumberFormatLike | null | undefined): string {
  const s = raw.trim();
  if (s === '') return '';
  const { group, decimal } = localeSeparators(format?.locale);
  // Whitespace is only ever a grouping char in numbers (nbsp/narrow-nbsp too).
  let out = s.replace(/\s/gu, '');
  if (group.trim() !== '') out = out.split(group).join('');
  if (decimal !== '.') out = out.split(decimal).join('.');
  return out;
}

/**
 * Blur canonicalization: strip grouping, normalize the decimal to '.', and
 * round to `decimalPlaces` when set — so the stored value is a plain ASCII
 * number that `Number()` parses and that display==submit. Returns the original
 * `raw` when it isn't a finite number, leaving the validator to reject it.
 */
export function canonicalizeNumber(raw: string, format: NumberFormatLike | null | undefined): string {
  const ascii = toAscii(raw, format);
  if (ascii === '') return '';
  const n = Number(ascii);
  if (!Number.isFinite(n)) return raw;
  const dp = format?.decimalPlaces;
  // Round with the SAME algorithm the server uses (Math.round, round-half-up) —
  // `toFixed` rounds negative .5 ties the other way, so display would disagree
  // with the stored/submitted value for e.g. -2.5.
  if (dp === undefined) return String(n);
  const factor = 10 ** dp;
  return String(Math.round(n * factor) / factor);
}

/** Tolerant parse for the validators: grouped input parses instead of NaN-ing. */
export function numericValue(value: unknown, format: NumberFormatLike | null | undefined): number {
  return Number(toAscii(String(value ?? ''), format));
}
