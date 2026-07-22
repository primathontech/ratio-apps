import { z } from 'zod';
import { baseFieldShape } from '../_shared/base';

/** Email format is enforced at submit-time; no extra config beyond basics. */
export const emailFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('email'),
});
