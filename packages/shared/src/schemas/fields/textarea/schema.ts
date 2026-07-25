import { z } from 'zod';
import { baseFieldShape, MIN_MAX_MESSAGE, minMaxConsistent } from '../_shared/base';
import { TEXTAREA_COUNTER_UNITS, TEXTAREA_ROW_MAX, TEXTAREA_ROW_MIN } from './constants';

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

/**
 * Batch-4 "field depth": display-only presentation for the textarea (auto-grow +
 * min/max rows, soft-vs-hard max-length, counter unit, monospace). One nested,
 * self-refined object so the discriminated-union member (`textareaFieldSchema`)
 * stays a plain `ZodObject` (no `ZodEffects` wrapper). Every key is optional so
 * existing forms stay valid, and every key is enum / bool / bounded-int only.
 */
const rowCount = () => z.number().int().min(TEXTAREA_ROW_MIN).max(TEXTAREA_ROW_MAX);

export const textareaDisplaySchema = z
  .object({
    /** Initial (and, without auto-grow, fixed) visible rows. */
    minRows: rowCount().optional(),
    /** Upper clamp for auto-grow; beyond it the textarea scrolls. */
    maxRows: rowCount().optional(),
    /** Grow with content between minRows and maxRows (`field-sizing: content`). */
    autoGrow: z.boolean().optional(),
    /** Add a native `maxlength` so typing stops at the limit (server always
     * hard-enforces maxLength regardless — this only mirrors it client-side). */
    enforceMaxLength: z.boolean().optional(),
    /** Live counter unit: characters (default) or words. */
    counterUnit: z.enum(TEXTAREA_COUNTER_UNITS).optional(),
    /** Render the value in a network-free monospace stack. */
    monospace: z.boolean().optional(),
  })
  .refine((d) => d.minRows === undefined || d.maxRows === undefined || d.minRows <= d.maxRows, {
    message: 'minRows cannot exceed maxRows',
    path: ['minRows'],
  });

export type TextareaDisplay = z.infer<typeof textareaDisplaySchema>;

export const textareaFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('textarea'),
  validation: textareaValidationSchema.default({
    maxLength: FORM_TEXTAREA_DEFAULT_MAX_LENGTH,
  }),
  display: textareaDisplaySchema.optional(),
});
