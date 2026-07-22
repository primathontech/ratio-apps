import { z } from 'zod';
import { contentBlockBaseShape } from '../_shared/base';

/** divider: a horizontal rule; no config beyond key + width. */
export const dividerFieldSchema = z.object({
  ...contentBlockBaseShape,
  type: z.literal('divider'),
});
