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

/** number: optional min/max/step + integer flag; enforced at submit-time. */
export const numberFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('number'),
  validation: numberValidationSchema.optional(),
});
