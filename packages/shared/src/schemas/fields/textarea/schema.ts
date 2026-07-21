import { z } from 'zod';
import { baseFieldShape, MIN_MAX_MESSAGE, minMaxConsistent } from '../_shared/base';

/** Textarea length: 5,000 default, merchant-raisable to 10,000 (PRD F13). */
export const FORM_TEXTAREA_DEFAULT_MAX_LENGTH = 5000;
export const FORM_TEXTAREA_HARD_MAX_LENGTH = 10000;

/** textarea: length bounds; max defaults to 5,000 and is capped at 10,000. */
const textareaValidationSchema = z
  .object({
    minLength: z.number().int().min(0).optional(),
    maxLength: z
      .number()
      .int()
      .min(1)
      .max(FORM_TEXTAREA_HARD_MAX_LENGTH, {
        message: `textarea maxLength cannot exceed ${FORM_TEXTAREA_HARD_MAX_LENGTH}`,
      })
      .default(FORM_TEXTAREA_DEFAULT_MAX_LENGTH),
  })
  .refine(minMaxConsistent, MIN_MAX_MESSAGE);

export const textareaFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('textarea'),
  validation: textareaValidationSchema.default({
    maxLength: FORM_TEXTAREA_DEFAULT_MAX_LENGTH,
  }),
});
