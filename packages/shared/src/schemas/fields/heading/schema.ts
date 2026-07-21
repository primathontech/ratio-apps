import { z } from 'zod';
import { contentBlockBaseShape } from '../_shared/base';

/** Heading levels for the heading block — curated so no h1 collides with the page. */
export const FORM_HEADING_LEVELS = ['h2', 'h3'] as const;

export type FormHeadingLevel = (typeof FORM_HEADING_LEVELS)[number];

/** heading: a short section title rendered as <h2>/<h3>. */
export const headingFieldSchema = z.object({
  ...contentBlockBaseShape,
  type: z.literal('heading'),
  text: z.string().min(1, { message: 'heading text is required' }).max(255),
  level: z.enum(FORM_HEADING_LEVELS).default('h2'),
});
