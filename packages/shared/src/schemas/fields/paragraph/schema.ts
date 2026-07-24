import { z } from 'zod';
import { contentBlockBaseShape } from '../_shared/base';

/** paragraph: a block of copy rendered via textContent (never innerHTML). */
export const paragraphFieldSchema = z.object({
  ...contentBlockBaseShape,
  type: z.literal('paragraph'),
  text: z.string().min(1, { message: 'paragraph text is required' }).max(2000),
});
