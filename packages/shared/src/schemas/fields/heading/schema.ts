import { z } from 'zod';
import { contentBlockBaseShape, FORM_BLOCK_ALIGNMENTS } from '../_shared/base';

/** Heading levels for the heading block — curated so no h1 collides with the page. */
export const FORM_HEADING_LEVELS = ['h2', 'h3'] as const;

export type FormHeadingLevel = (typeof FORM_HEADING_LEVELS)[number];

/** Visual size for the heading block (§4.15) — decoupled from the semantic
 * `level` so a merchant can keep an <h3> tag but render it large (or vice
 * versa). 'md' is the default and reproduces the previous <h2> size baseline. */
export const FORM_HEADING_SIZES = ['sm', 'md', 'lg'] as const;

export type FormHeadingSize = (typeof FORM_HEADING_SIZES)[number];

/** heading: a short section title rendered as <h2>/<h3>. */
export const headingFieldSchema = z.object({
  ...contentBlockBaseShape,
  type: z.literal('heading'),
  text: z.string().min(1, { message: 'heading text is required' }).max(255),
  level: z.enum(FORM_HEADING_LEVELS).default('h2'),
  // §4.15 appearance — all optional/defaulted so an existing heading is unchanged.
  // eyebrow: a small kicker line rendered above the heading (text node only).
  eyebrow: z.string().max(120).optional(),
  // size: visual scale, independent of the semantic `level`. 'md' = today.
  size: z.enum(FORM_HEADING_SIZES).default('md'),
  // align: text alignment for the eyebrow + heading. 'left' = today.
  align: z.enum(FORM_BLOCK_ALIGNMENTS).default('left'),
});
