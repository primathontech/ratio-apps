import { z } from 'zod';
import { contentBlockBaseShape, FORM_BLOCK_ALIGNMENTS } from '../_shared/base';

/** paragraph: a block of copy rendered via textContent (never innerHTML). */
export const paragraphFieldSchema = z.object({
  ...contentBlockBaseShape,
  type: z.literal('paragraph'),
  text: z.string().min(1, { message: 'paragraph text is required' }).max(2000),
  // §4.15 appearance — text alignment; 'left' = today.
  align: z.enum(FORM_BLOCK_ALIGNMENTS).default('left'),
});
