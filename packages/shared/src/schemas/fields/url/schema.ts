import { z } from 'zod';
import { baseFieldShape } from '../_shared/base';

/** URL format is enforced at submit-time (like email); no extra config here. */
export const urlFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('url'),
});
