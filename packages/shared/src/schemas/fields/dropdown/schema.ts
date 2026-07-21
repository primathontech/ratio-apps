import { z } from 'zod';
import { baseFieldShape, optionsSchema } from '../_shared/base';

export const dropdownFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('dropdown'),
  options: optionsSchema,
});
