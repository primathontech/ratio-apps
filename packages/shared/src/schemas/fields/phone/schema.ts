import { z } from 'zod';
import { baseFieldShape } from '../_shared/base';

/** Phone is +91 + 10 digits in v1 — enforced at submit-time, no config here. */
export const phoneFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('phone'),
});
