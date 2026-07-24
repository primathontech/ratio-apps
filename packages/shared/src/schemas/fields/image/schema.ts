import { z } from 'zod';
import { contentBlockBaseShape, httpsAssetUrl } from '../_shared/base';

/** image: a display image; reuses the audited https-only asset flow. */
export const imageFieldSchema = z.object({
  ...contentBlockBaseShape,
  type: z.literal('image'),
  url: httpsAssetUrl,
  alt: z.string().max(255).optional(),
});
