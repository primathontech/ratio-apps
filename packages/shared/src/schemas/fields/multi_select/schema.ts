import { z } from 'zod';
import { baseFieldShape, optionsSchema } from '../_shared/base';

export const multiSelectFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('multi_select'),
  options: optionsSchema,
});
