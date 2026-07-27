import { z } from 'zod';
import { baseFieldShape, optionsSchema, selectOtherShape } from '../_shared/base';

export const dropdownFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('dropdown'),
  options: optionsSchema,
  // All new keys OPTIONAL so pre-enrichment forms stay valid; defaults = today.
  ...selectOtherShape,
  // A pre-selected option value. Must equal one of the option values — that
  // membership is enforced at the `formFieldsSchema` level (kept off the member
  // so the discriminated-union member stays a plain ZodObject).
  defaultValue: z.string().min(1).max(255).optional(),
  // Leading placeholder/prompt option text (replaces the default "Select…").
  prompt: z.string().max(120).optional(),
  // When true the SDK renders a filterable, keyboard-navigable combobox; when
  // false (default) it keeps today's native <select>.
  searchable: z.boolean().optional(),
});
