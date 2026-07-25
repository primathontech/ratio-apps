import { z } from 'zod';
import { baseFieldShape } from '../_shared/base';

/** url: optional https-only flag + length cap; enforced at submit-time. */
const urlValidationSchema = z.object({
  requireHttps: z.boolean().default(false),
  maxLength: z.number().int().positive().max(2048).optional(),
});

/** URL format is enforced at submit-time (like email); optional https/length config. */
export const urlFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('url'),
  validation: urlValidationSchema.optional(),
});
