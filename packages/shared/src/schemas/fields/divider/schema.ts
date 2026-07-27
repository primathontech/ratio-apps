import { z } from 'zod';
import { contentBlockBaseShape } from '../_shared/base';

/** Divider rendering (§4.15): 'line' = today's solid rule; 'dashed'/'dotted'
 * flip only the border-style; 'spacer' is an invisible vertical gap. */
export const FORM_DIVIDER_VARIANTS = ['line', 'dashed', 'dotted', 'spacer'] as const;

export type FormDividerVariant = (typeof FORM_DIVIDER_VARIANTS)[number];

/** divider: a horizontal rule (or an invisible spacer). */
export const dividerFieldSchema = z.object({
  ...contentBlockBaseShape,
  type: z.literal('divider'),
  // §4.15 appearance — 'line' + absent spacing reproduce today's rule.
  variant: z.enum(FORM_DIVIDER_VARIANTS).default('line'),
  // spacing: vertical space around the rule (line/dashed/dotted) or the gap
  // height (spacer), in px. Bounded so only a plain integer reaches the inline
  // style. Absent ⇒ today's 4px margin (rule) / the SDK's default gap (spacer).
  spacing: z.number().int().min(0).max(80).optional(),
});
