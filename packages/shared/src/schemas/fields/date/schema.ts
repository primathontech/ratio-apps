import { z } from 'zod';
import { baseFieldShape } from '../_shared/base';

/** ISO calendar-date string (YYYY-MM-DD) — same shape the submit-time validator enforces. */
const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'must be an ISO date (YYYY-MM-DD)' });

/** min must be on or before max when both are set (lexical compare is exact for ISO dates). */
const dateMinMaxConsistent = (v: { min?: string | undefined; max?: string | undefined }): boolean =>
  v.min === undefined || v.max === undefined || v.min <= v.max;

/**
 * date: optional [min,max] ISO bounds enforced at submit-time, plus a client-only
 * `defaultTo` prefill ('today' seeds the input in the SDK; the server never
 * fabricates a value from it). The strict ISO shape itself is always enforced.
 */
const dateValidationSchema = z
  .object({
    min: isoDateString.optional(),
    max: isoDateString.optional(),
    defaultTo: z.enum(['today', '']).optional(),
  })
  .refine(dateMinMaxConsistent, { message: 'min must be less than or equal to max' });

export const dateFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('date'),
  validation: dateValidationSchema.optional(),
});
