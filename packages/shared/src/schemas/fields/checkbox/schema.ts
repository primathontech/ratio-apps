import { z } from 'zod';
import { baseFieldShape } from '../_shared/base';

/** checkbox: single consent box; optional policy link (https-only). */
export const checkboxFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('checkbox'),
  linkUrl: z
    .string()
    .url({ message: 'linkUrl must be a valid URL' })
    .max(2048)
    .refine((url) => url.startsWith('https://'), { message: 'linkUrl must use https://' })
    .optional(),
  linkText: z.string().min(1).max(255).optional(),
});
