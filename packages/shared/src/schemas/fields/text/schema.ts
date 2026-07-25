import { z } from 'zod';
import {
  baseFieldShape,
  MIN_MAX_MESSAGE,
  minMaxConsistent,
  regexPatternSchema,
} from '../_shared/base';
import {
  FORM_AUTOCOMPLETE_TOKENS,
  FORM_TEXT_FORMATS,
  FORM_TEXT_HARD_MAX_LENGTH,
  FORM_TEXT_TRANSFORMS,
} from './constants';

/**
 * text validation: optional format preset + custom regex + length bounds +
 * server-authoritative transform. All keys OPTIONAL so existing forms stay
 * valid. `maxLength` is capped at the hard ceiling (the server additionally
 * enforces `min(maxLength, HARD_MAX)` even when unset). Constants live in the
 * Zod-free `./constants` so the SDK bundle can import them without pulling Zod.
 */
const textValidationSchema = z
  .object({
    // Named preset library; `custom` ⇒ use `pattern`, `none`/absent ⇒ no format.
    format: z.enum(FORM_TEXT_FORMATS).optional(),
    // Merchant-authored regex (ReDoS-hardened) used when format is custom/none.
    pattern: regexPatternSchema.optional(),
    // Message shown when the format/pattern check fails (bounded).
    patternMessage: z.string().max(120).optional(),
    // Server-authoritative normalization applied before length/pattern checks.
    transform: z.enum(FORM_TEXT_TRANSFORMS).optional(),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(1).max(FORM_TEXT_HARD_MAX_LENGTH).optional(),
  })
  .refine(minMaxConsistent, MIN_MAX_MESSAGE);

export const textFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('text'),
  // Native autofill hint — curated token allowlist (no open-ended string).
  autocomplete: z.enum(FORM_AUTOCOMPLETE_TOKENS).optional(),
  validation: textValidationSchema.optional(),
});
