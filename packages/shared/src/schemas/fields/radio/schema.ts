import { z } from 'zod';
import { baseFieldShape, optionsSchema, selectOtherShape } from '../_shared/base';
import {
  RADIO_LAYOUTS,
  RADIO_MAX_GRID_COLUMNS,
  RADIO_MIN_GRID_COLUMNS,
  RADIO_VARIANTS,
} from '../_shared/select-constants';

// Re-export the layout/variant enums next to the field schema so `form-schema`
// can surface them (mirrors multi_select's display-mode constants).
export {
  RADIO_LAYOUTS,
  RADIO_MAX_GRID_COLUMNS,
  RADIO_MIN_GRID_COLUMNS,
  RADIO_VARIANTS,
  type RadioLayout,
  type RadioVariant,
} from '../_shared/select-constants';

/** radio: single-choice — reuses the dropdown/multi_select options shape. */
export const radioFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('radio'),
  options: optionsSchema,
  // All new keys OPTIONAL so pre-enrichment forms stay valid; defaults = today.
  ...selectOtherShape,
  // Pre-selected option value; membership enforced at the `formFieldsSchema`
  // level so this member stays a plain ZodObject for the discriminated union.
  defaultValue: z.string().min(1).max(255).optional(),
  // Choice flow — `vertical` (today) / `horizontal` / `grid`.
  layout: z.enum(RADIO_LAYOUTS).optional(),
  // Column count, honored only when layout === 'grid'. Bounded 2–4.
  gridColumns: z.number().int().min(RADIO_MIN_GRID_COLUMNS).max(RADIO_MAX_GRID_COLUMNS).optional(),
  // Visual style — `list` (today) / `button` / `card`.
  variant: z.enum(RADIO_VARIANTS).optional(),
});
