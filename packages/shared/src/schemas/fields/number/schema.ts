import { z } from 'zod';
import { baseFieldShape, numberMinMaxConsistent } from '../_shared/base';

/** number: optional numeric bounds + step; `integer` forbids decimals. */
const numberValidationSchema = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    integer: z.boolean().default(false),
  })
  .refine(numberMinMaxConsistent, { message: 'min must be less than or equal to max' });

// ── Display formatting (Batch-4 field depth) ───────────────────
// A DISPLAY-ONLY layer: the SDK reflects these through `Intl.NumberFormat`
// (a browser global — no shared runtime constant needed) to render a grouped /
// currency / percent string on blur, while the submitted + stored value stays a
// plain JS number. Every key is a bounded enum / bounded int / bool, so nothing
// dynamic reaches `Intl` or the DOM.

/** Notation style. `currency` pairs with `currency`; `percent` divides by 100 for display. */
export const FORM_NUMBER_STYLES = ['decimal', 'currency', 'percent'] as const;
export type FormNumberStyle = (typeof FORM_NUMBER_STYLES)[number];

/** Curated ISO-4217 set — bounded so an arbitrary string can never reach Intl's `currency` option. */
export const FORM_NUMBER_CURRENCIES = [
  'INR',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'AUD',
  'CAD',
  'SGD',
  'AED',
  'CNY',
] as const;
export type FormNumberCurrency = (typeof FORM_NUMBER_CURRENCIES)[number];

/** Curated BCP-47 locales — bounded so only a known locale drives grouping/decimal separators. */
export const FORM_NUMBER_LOCALES = ['en-IN', 'en-US', 'en-GB', 'de-DE', 'fr-FR', 'ja-JP'] as const;
export type FormNumberLocale = (typeof FORM_NUMBER_LOCALES)[number];

/** Hard ceiling on `decimalPlaces` — bounds `10 ** decimalPlaces` used for rounding. */
export const FORM_NUMBER_MAX_DECIMALS = 10;

/**
 * Display formatting for the number field. A plain nested object (defaults, no
 * cross-field refine) so `numberFieldSchema` stays a bare `ZodObject` member of
 * the discriminated union. Absent ⇒ today's native `type="number"` input,
 * unchanged. `decimalPlaces` is optional so "use the locale/currency default"
 * stays expressible.
 */
const numberFormatSchema = z.object({
  style: z.enum(FORM_NUMBER_STYLES).default('decimal'),
  currency: z.enum(FORM_NUMBER_CURRENCIES).default('INR'),
  locale: z.enum(FORM_NUMBER_LOCALES).default('en-IN'),
  grouping: z.boolean().default(true),
  decimalPlaces: z.number().int().min(0).max(FORM_NUMBER_MAX_DECIMALS).optional(),
});

export type FormNumberFormat = z.infer<typeof numberFormatSchema>;

/** number: optional min/max/step + integer flag; enforced at submit-time. */
export const numberFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('number'),
  validation: numberValidationSchema.optional(),
  // Display-only formatting; the stored value stays a number (see above).
  format: numberFormatSchema.optional(),
});
