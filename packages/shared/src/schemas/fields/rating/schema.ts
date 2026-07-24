import { z } from 'zod';
import { baseFieldShape } from '../_shared/base';

/** Star/heart glyphs for the rating control. Enum keeps the glyph curated. */
export const FORM_RATING_ICONS = ['star', 'heart'] as const;

export type FormRatingIcon = (typeof FORM_RATING_ICONS)[number];

/** rating: a 3..10 scale rendered as star/heart glyphs. */
export const ratingFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('rating'),
  max: z.number().int().min(3).max(10).default(5),
  icon: z.enum(FORM_RATING_ICONS).default('star'),
});
