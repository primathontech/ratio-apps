import { z } from 'zod';

/**
 * Shared field-schema primitives (Phase 0 per-field module refactor). Every
 * per-field module in `../<type>/schema.ts` composes from these; nothing here
 * adds behavior — it is a pure extraction of the helpers that used to live
 * inline in `form-schema.ts` so field modules import rather than duplicate.
 */

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

/** A merchant-supplied validation regex — must compile. */
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
  );

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
