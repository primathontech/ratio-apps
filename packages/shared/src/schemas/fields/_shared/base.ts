import { z } from 'zod';

/**
 * Shared field-schema primitives (Phase 0 per-field module refactor). Every
 * per-field module in `../<type>/schema.ts` composes from these; nothing here
 * adds behavior — it is a pure extraction of the helpers that used to live
 * inline in `form-schema.ts` so field modules import rather than duplicate.
 */

/**
 * Reserved field keys — names the export/webhook layer appends as its own
 * columns. A merchant field key may never collide with these, or the CSV would
 * emit two identically-named columns (e.g. two `submitted_at`) and header-keyed
 * parsers would collapse or mis-map them (P2-11). Webhook is immune (fields is
 * a nested object), but the key is reserved uniformly to keep the contract simple.
 */
export const RESERVED_FIELD_KEYS = ['submitted_at'] as const;

/**
 * Field key — becomes the JSON key in `data_json`, the CSV header, and the
 * `fields` key of the `form.submitted` payload. Machine-safe by construction.
 */
export const formFieldKeySchema = z
  .string()
  .min(1, { message: 'field key is required' })
  .max(64, { message: 'field key must be at most 64 characters' })
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, {
    message: 'field key must start with a letter and contain only letters, digits, and underscores',
  })
  .refine((key) => !(RESERVED_FIELD_KEYS as readonly string[]).includes(key), {
    message: 'field key is reserved and cannot be used',
  });

/** Field render width — two consecutive 'half' fields sit side-by-side. */
export const FORM_FIELD_WIDTHS = ['full', 'half'] as const;

export type FormFieldWidth = (typeof FORM_FIELD_WIDTHS)[number];

// Asset URL for hosted images (content-block image, logo/cover, background) —
// https-only, same posture as webhookUrl/linkUrl so nothing dynamic (http,
// data:, javascript:) reaches an <img src> or CSS url().
export const httpsAssetUrl = z
  .string()
  .url({ message: 'must be a valid URL' })
  .max(2048)
  .refine((url) => url.startsWith('https://'), { message: 'must use https://' });

// Hex only (#rgb / #rrggbb / #rrggbbaa). Rejects rgb()/hsl()/url()/named
// colors so nothing dynamic reaches the CSS var. max length is a cheap DoS
// guard. Shared by the appearance colors and the per-field accent override.
export const hexColor = z
  .string()
  .trim()
  .max(9)
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Must be a hex color');

// Input look (§1.2): 'outlined' = today. 'filled'/'underlined' reflect to a
// host data-input attribute and flip only private tokens — no new colors. A
// per-field override (§2.2) may pin one field to a different variant.
export const FORM_INPUT_VARIANTS = ['outlined', 'filled', 'underlined'] as const;
export type FormInputVariant = (typeof FORM_INPUT_VARIANTS)[number];

/** Shared per-field basics — every field type carries these. */
export const baseFieldShape = {
  key: formFieldKeySchema,
  label: z.string().min(1, { message: 'label is required' }).max(255),
  placeholder: z.string().max(255).optional(),
  required: z.boolean().default(false),
  width: z.enum(FORM_FIELD_WIDTHS).default('full'), // 'full' = today's single-column
  // §2.2 — per-field style override. Optional so absent = inherits the global
  // inputVariant/accent; when set, the SDK scopes it to that field's element
  // (setProperty on --wz-* / a per-wrapper data-input attribute), never global.
  style: z
    .object({
      inputVariant: z.enum(FORM_INPUT_VARIANTS).optional(),
      accent: hexColor.optional(),
    })
    .optional(),
  // §2.3 — per-field adornments (all text nodes, zero injection surface).
  // prefix/suffix/help apply to text-like inputs; counter only meaningful
  // alongside a validation.maxLength. Absent ⇒ nothing rendered ⇒ unchanged.
  prefix: z.string().max(8).optional(),
  suffix: z.string().max(8).optional(),
  helpText: z.string().max(200).optional(),
  showCounter: z.boolean().default(false),
};

// Content blocks share only key + width — no label/required/validation. Keeping
// `key` lets the uniqueness superRefine and half-width pairing treat them uniformly.
export const contentBlockBaseShape = {
  key: formFieldKeySchema,
  width: z.enum(FORM_FIELD_WIDTHS).default('full'),
};

/**
 * Parse a regex quantifier at `src[i]` (`*`, `+`, `?`, `{n}`, `{n,}`, `{n,m}`
 * with an optional trailing lazy/possessive marker). Returns the max repeat
 * count (Infinity for unbounded) and the index just past the quantifier, or
 * null when there is no quantifier here.
 */
function parseQuantifier(src: string, i: number): { maxRepeat: number; end: number } | null {
  const c = src[i];
  const consumeLazy = (end: number): number =>
    src[end] === '?' || src[end] === '+' ? end + 1 : end;
  if (c === '*' || c === '+')
    return { maxRepeat: Number.POSITIVE_INFINITY, end: consumeLazy(i + 1) };
  if (c === '?') return { maxRepeat: 1, end: consumeLazy(i + 1) };
  if (c === '{') {
    const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(src.slice(i));
    if (!m) return null;
    const lower = Number(m[1]);
    let maxRepeat: number;
    if (m[2] === undefined)
      maxRepeat = lower; // {n}
    else if (m[3] === undefined || m[3] === '')
      maxRepeat = Number.POSITIVE_INFINITY; // {n,}
    else maxRepeat = Number(m[3]); // {n,m}
    return { maxRepeat, end: consumeLazy(i + m[0].length) };
  }
  return null;
}

/**
 * Lightweight, safe-regex-style lint for catastrophic backtracking (P1-1).
 * Merchant `pattern`s are compiled and `.test()`ed against shopper input on
 * the UNAUTHENTICATED public submit path; a nested-quantifier shape like
 * `(a+)+`, `(a*)*`, or `(.*a){20}` backtracks exponentially and pins the shared
 * event loop. We reject those shapes at SAVE time (this lint), and bound the
 * tested input length at submit time (text/validate.ts) as defense in depth.
 *
 * Heuristic: track, per group, whether it contains a *variable-length*
 * repetition (an atom/class/group repeated more than once — `*`, `+`, `{n,}`,
 * `{n,m}` with m>1, `{n}` with n>1). Flag when such a variable group is itself
 * repeated more than once — that is the nested-quantifier signature. Overlap
 * alternations like `(a|a)+` are not caught here; the submit-time input cap is
 * the backstop for the residual.
 */
export function hasCatastrophicBacktracking(pattern: string): boolean {
  type Frame = { variable: boolean };
  const stack: Frame[] = [{ variable: false }];
  const cur = (): Frame => stack[stack.length - 1] as Frame;
  const n = pattern.length;
  let i = 0;
  while (i < n) {
    const c = pattern[i];
    if (c === '\\') {
      // Escaped atom (e.g. \d, \(); a quantifier may follow it.
      i += 2;
      const q = parseQuantifier(pattern, i);
      if (q) {
        if (q.maxRepeat > 1) cur().variable = true;
        i = q.end;
      }
      continue;
    }
    if (c === '[') {
      // Character class: quantifiers inside are literal, so skip to the close.
      i++;
      if (pattern[i] === '^') i++;
      if (pattern[i] === ']') i++; // literal ] as first class member
      while (i < n && pattern[i] !== ']') i += pattern[i] === '\\' ? 2 : 1;
      i++; // consume ]
      const q = parseQuantifier(pattern, i);
      if (q) {
        if (q.maxRepeat > 1) cur().variable = true;
        i = q.end;
      }
      continue;
    }
    if (c === '(') {
      // Step past a group prefix — (?: , (?= , (?! , (?<= , (?<! , (?<name> .
      let j = i + 1;
      if (pattern[j] === '?') {
        j++;
        if (pattern[j] === '<' && pattern[j + 1] !== '=' && pattern[j + 1] !== '!') {
          j++;
          while (j < n && pattern[j] !== '>') j++;
          j++;
        } else if (pattern[j] === '<') j += 2;
        else if (pattern[j] === ':' || pattern[j] === '=' || pattern[j] === '!') j++;
      }
      stack.push({ variable: false });
      i = j;
      continue;
    }
    if (c === ')') {
      const frame = stack.pop() ?? { variable: false };
      i++;
      const q = parseQuantifier(pattern, i);
      if (q && q.maxRepeat > 1 && frame.variable) return true; // nested quantifier
      // A variable subgroup bubbles up structurally; repeating the group at all
      // adds variability to the parent.
      cur().variable = cur().variable || frame.variable || (q ? q.maxRepeat > 1 : false);
      if (q) i = q.end;
      continue;
    }
    // Ordinary atom (literal or `.`); a quantifier may follow.
    i++;
    const q = parseQuantifier(pattern, i);
    if (q) {
      if (q.maxRepeat > 1) cur().variable = true;
      i = q.end;
    }
  }
  return false;
}

/**
 * Regex features the submit-time engine (RE2, linear-time / backtracking-immune
 * — see backend `regex-engine.ts`) cannot execute: backreferences (`\1`,
 * `\k<name>`) and lookaround (`(?=`, `(?!`, `(?<=`, `(?<!`). RE2 rejects these
 * at compile time, so a merchant pattern using one would reject EVERY
 * submission at runtime. We detect them here (in the isomorphic save-time
 * schema, which never bundles the native module) and reject the pattern up
 * front instead. Named groups `(?<name>...)` and non-capturing `(?:...)` ARE
 * supported and must not be flagged.
 */
export function usesUnsupportedRegexFeature(pattern: string): boolean {
  const n = pattern.length;
  let i = 0;
  let inClass = false;
  while (i < n) {
    const c = pattern[i];
    if (c === '\\') {
      const next = pattern[i + 1];
      // Backreferences are meaningful only outside a character class.
      if (!inClass && next !== undefined && ((next >= '1' && next <= '9') || next === 'k')) {
        return true;
      }
      i += 2; // escaped atom — consume the escape + its target
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      i++;
      continue;
    }
    if (c === '[') {
      inClass = true;
      i++;
      continue;
    }
    if (c === '(' && pattern[i + 1] === '?') {
      const marker = pattern[i + 2];
      // Lookahead (?= (?! and lookbehind (?<= (?<! — but NOT named group (?<name>.
      if (marker === '=' || marker === '!') return true;
      if (marker === '<' && (pattern[i + 3] === '=' || pattern[i + 3] === '!')) return true;
    }
    i++;
  }
  return false;
}

/**
 * A merchant-supplied validation regex — must compile, must not exhibit a
 * catastrophic-backtracking shape, and must be runnable by the RE2 submit-time
 * engine (P1-1 ReDoS). The 500-char cap bounds the lint cost itself.
 */
export const regexPatternSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (pattern) => {
      try {
        new RegExp(pattern);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'pattern must be a valid regular expression' },
  )
  .refine((pattern) => !hasCatastrophicBacktracking(pattern), {
    message: 'pattern is too complex (catastrophic backtracking) and is not allowed',
  })
  .refine((pattern) => !usesUnsupportedRegexFeature(pattern), {
    message: 'pattern uses an unsupported feature (backreferences and lookaround are not allowed)',
  });

export const minMaxConsistent = (v: {
  minLength?: number | undefined;
  maxLength?: number | undefined;
}): boolean => v.minLength === undefined || v.maxLength === undefined || v.minLength <= v.maxLength;

export const MIN_MAX_MESSAGE = { message: 'minLength must be less than or equal to maxLength' };

/** dropdown / multi_select / radio choices — at least one non-empty option. */
export const optionsSchema = z
  .array(z.string().min(1, { message: 'options cannot be empty strings' }))
  .min(1, { message: 'at least one option is required' });

export const numberMinMaxConsistent = (v: {
  min?: number | undefined;
  max?: number | undefined;
}): boolean => v.min === undefined || v.max === undefined || v.min <= v.max;
