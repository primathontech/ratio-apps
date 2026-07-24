import { z } from 'zod';
import { baseFieldShape, optionsSchema } from '../_shared/base';

/** radio: single-choice — reuses the dropdown/multi_select options shape. */
export const radioFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('radio'),
  options: optionsSchema,
});
