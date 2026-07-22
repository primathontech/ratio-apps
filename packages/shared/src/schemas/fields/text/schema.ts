import { z } from 'zod';
import {
  baseFieldShape,
  MIN_MAX_MESSAGE,
  minMaxConsistent,
  regexPatternSchema,
} from '../_shared/base';

/** text: optional regex + length bounds. */
const textValidationSchema = z
  .object({
    pattern: regexPatternSchema.optional(),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(1).optional(),
  })
  .refine(minMaxConsistent, MIN_MAX_MESSAGE);

export const textFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('text'),
  validation: textValidationSchema.optional(),
});
