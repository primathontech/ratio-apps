import { z } from 'zod';
import { baseFieldShape, MAX_OPTIONS, optionsSchema, selectOtherShape } from '../_shared/base';

/**
 * multi_select display mode (P0 field-depth). `checklist` = today's stacked
 * checkboxes; `chips` = wrap-flow toggle pills. Enum only — the SDK maps it to
 * a bounded inline layout, never a raw merchant CSS string.
 */
export const MULTI_SELECT_DISPLAY_MODES = ['checklist', 'chips'] as const;
export type MultiSelectDisplayMode = (typeof MULTI_SELECT_DISPLAY_MODES)[number];

/**
 * Column-count bounds for the checklist grid. A bounded integer so the SDK can
 * inline `repeat(N, …)` from a trusted number, never an unbounded/user string.
 */
export const MULTI_SELECT_MIN_COLUMNS = 1;
export const MULTI_SELECT_MAX_COLUMNS = 3;

/**
 * Selection-count bounds. Both optional; when present each is a bounded
 * non-negative integer and `min ≤ max`. Server-authoritative — enforced in
 * `submissions/fields/multi_select/validate.ts` regardless of the client, which
 * is bypassable on the public submit path.
 */
const multiSelectSelectionSchema = z
  .object({
    min: z.number().int().min(0).max(MAX_OPTIONS).optional(),
    max: z.number().int().min(1).max(MAX_OPTIONS).optional(),
  })
  .refine((v) => v.min === undefined || v.max === undefined || v.min <= v.max, {
    message: 'minimum selections must be less than or equal to maximum selections',
  });

export const multiSelectFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('multi_select'),
  options: optionsSchema,
  // All new keys are OPTIONAL so forms saved before this enrichment stay valid.
  ...selectOtherShape,
  // Pre-selected option values (a subset of the option values). Subset
  // membership is enforced at the `formFieldsSchema` level so this member stays
  // a plain ZodObject for the discriminated union.
  defaultValue: z.array(z.string().min(1).max(255)).max(MAX_OPTIONS).optional(),
  selection: multiSelectSelectionSchema.optional(),
  display: z.enum(MULTI_SELECT_DISPLAY_MODES).optional(),
  columns: z.number().int().min(MULTI_SELECT_MIN_COLUMNS).max(MULTI_SELECT_MAX_COLUMNS).optional(),
  showSelectAll: z.boolean().optional(),
});
