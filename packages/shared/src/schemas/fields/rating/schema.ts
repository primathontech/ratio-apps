import { z } from 'zod';
import { baseFieldShape } from '../_shared/base';

/** Star/heart glyphs for the rating control. Enum keeps the glyph curated. */
export const FORM_RATING_ICONS = ['star', 'heart'] as const;

export type FormRatingIcon = (typeof FORM_RATING_ICONS)[number];

/**
 * Rating display style. 'stars' renders the star/heart glyph scale (today's
 * behavior); 'numbers' renders numbered buttons (min..max) for NPS/opinion
 * scales. Absent ⇒ 'stars', so existing fields are unchanged.
 */
export const FORM_RATING_DISPLAYS = ['stars', 'numbers'] as const;

export type FormRatingDisplay = (typeof FORM_RATING_DISPLAYS)[number];

/**
 * rating: a scale rendered as star/heart glyphs (default) or numbered buttons.
 * `min` (0 or 1, default 1 when absent) allows a 0-based scale so a 0–10 NPS is
 * possible; `lowLabel`/`highLabel` are optional end labels shown under the
 * scale (e.g. "Not likely" … "Very likely"). All new config is optional and
 * enforced at submit-time, mirroring the number field's optional bounds.
 */
export const ratingFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('rating'),
  min: z.number().int().min(0).max(1).optional(),
  max: z.number().int().min(3).max(10).default(5),
  icon: z.enum(FORM_RATING_ICONS).default('star'),
  display: z.enum(FORM_RATING_DISPLAYS).optional(),
  lowLabel: z.string().max(80).optional(),
  highLabel: z.string().max(80).optional(),
});
