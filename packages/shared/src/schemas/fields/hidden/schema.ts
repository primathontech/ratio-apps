import { z } from 'zod';
import { baseFieldShape } from '../_shared/base';

/** hidden: captured from URLSearchParams (UTM etc), never user-visible. */
export const hiddenFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('hidden'),
  paramName: z
    .string()
    .min(1, { message: 'paramName is required' })
    .max(64, { message: 'paramName must be at most 64 characters' }),
});
