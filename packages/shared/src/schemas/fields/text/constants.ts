/**
 * Zod-free `text` field constants (Batch-4 field depth). The storefront SDK and
 * the backend submission validator import the runtime maps/helpers here at
 * runtime, so this module must NOT import Zod (mirrors `form-adornments.ts`).
 * The field's `schema.ts` re-imports these for its Zod refinements.
 */

// ── Format presets ────────────────────────────────────────────────
// A curated library of named validation patterns plus `custom` (use the raw
// `validation.pattern`) and `none`. The named presets map to a SERVER-AUTHORED,
// vetted regex source in FORM_TEXT_FORMAT_PATTERNS — safe (no catastrophic
// backtracking) and runnable by both native `RegExp('u')` (client + preset
// server path) and RE2 (only the merchant `custom` pattern uses RE2).
export const FORM_TEXT_FORMATS = [
  'none',
  'letters',
  'alphanumeric',
  'slug',
  'no_emoji',
  'pin',
  'pan',
  'gstin',
  'ifsc',
  'custom',
] as const;
export type FormTextFormat = (typeof FORM_TEXT_FORMATS)[number];

/**
 * Named preset → regex source (no flags; always compiled with the `u` flag).
 * Only general Unicode categories (`\p{L}`, `\p{N}`, `\p{So}`, `\p{Cs}`) are
 * used so RE2 and native `RegExp` agree. `none`/`custom` have no entry.
 * `no_emoji` is a best-effort guard (rejects "Symbol, other" + surrogates,
 * which covers the pictographic emoji range).
 */
export const FORM_TEXT_FORMAT_PATTERNS: Partial<Record<FormTextFormat, string>> = {
  letters: '^\\p{L}+$',
  alphanumeric: '^[\\p{L}\\p{N}]+$',
  slug: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
  no_emoji: '^[^\\p{So}\\p{Cs}]*$',
  pin: '^[1-9][0-9]{5}$',
  pan: '^[A-Z]{5}[0-9]{4}[A-Z]$',
  gstin: '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$',
  ifsc: '^[A-Z]{4}0[A-Z0-9]{6}$',
};

/** The server-authored preset source for a format, or undefined when the format
 * is unset / `none` / `custom` (those fall back to the raw `validation.pattern`). */
export function textFormatPattern(format: string | undefined): string | undefined {
  if (format === undefined) return undefined;
  return FORM_TEXT_FORMAT_PATTERNS[format as FormTextFormat];
}

// ── Value transform / normalize ───────────────────────────────────
export const FORM_TEXT_TRANSFORMS = [
  'none',
  'trim',
  'trim_upper',
  'trim_lower',
  'trim_title',
] as const;
export type FormTextTransform = (typeof FORM_TEXT_TRANSFORMS)[number];

/** Default applied when a text field does not configure a transform. */
export const FORM_TEXT_DEFAULT_TRANSFORM: FormTextTransform = 'trim';

function titleCase(s: string): string {
  return s.replace(/\S+/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Pure, isomorphic normalizer — the client applies it on blur (UX mirror) and
 * the server applies it authoritatively before any length/pattern check. Same
 * input ⇒ same canonical output on both sides, so verdicts never drift.
 */
export function applyTextTransform(value: string, transform: string | undefined): string {
  switch (transform ?? FORM_TEXT_DEFAULT_TRANSFORM) {
    case 'none':
      return value;
    case 'trim_upper':
      return value.trim().toUpperCase();
    case 'trim_lower':
      return value.trim().toLowerCase();
    case 'trim_title':
      return titleCase(value.trim());
    default:
      return value.trim();
  }
}

// ── Length ceiling ────────────────────────────────────────────────
/** Hard ceiling on a text value's length. The server always enforces
 * `min(maxLength ?? HARD_MAX, HARD_MAX)` even when the field configures nothing,
 * and the client reflects it as the native `maxlength` attribute. */
export const FORM_TEXT_HARD_MAX_LENGTH = 1000;

// ── Autocomplete token ────────────────────────────────────────────
/** Curated allowlist of WHATWG `autocomplete` tokens a text field may reflect.
 * Bounded enum (no open-ended string) so nothing arbitrary reaches the DOM. */
export const FORM_AUTOCOMPLETE_TOKENS = [
  'off',
  'on',
  'name',
  'given-name',
  'additional-name',
  'family-name',
  'nickname',
  'honorific-prefix',
  'honorific-suffix',
  'username',
  'email',
  'organization',
  'organization-title',
  'street-address',
  'address-line1',
  'address-line2',
  'address-level1',
  'address-level2',
  'country',
  'country-name',
  'postal-code',
  'tel',
  'tel-national',
  'url',
  'bday',
  'sex',
  'language',
] as const;
export type FormAutocompleteToken = (typeof FORM_AUTOCOMPLETE_TOKENS)[number];
