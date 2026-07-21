import { z } from 'zod';
import { baseFieldShape } from '../_shared/base';

export const dateFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('date'),
});
