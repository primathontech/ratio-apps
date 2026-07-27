import { z } from 'zod';
import { contentBlockBaseShape } from '../_shared/base';

/**
 * html: a display-only content block that renders raw, merchant-authored HTML
 * as-is in the form (top = header, bottom = footer, between fields = inline).
 * The stored value is an unconstrained string with only a length bound — the
 * SDK renders it via Lit's `unsafeHTML` with NO sanitization (a deliberate
 * product decision). Like the other content blocks it carries only key + width
 * and submits no data.
 */
export const htmlFieldSchema = z.object({
  ...contentBlockBaseShape,
  type: z.literal('html'),
  html: z
    .string()
    .max(10000, { message: 'custom HTML must be at most 10000 characters' })
    .default(''),
});
