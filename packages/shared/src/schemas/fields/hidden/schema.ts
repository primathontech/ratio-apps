import { z } from 'zod';
import { baseFieldShape } from '../_shared/base';
import { HIDDEN_MAX_VALUE_LENGTH, HIDDEN_SOURCES } from './constants';

/**
 * hidden: a value captured from page context (UTM param, cookie, referrer,
 * landing URL, timestamp) or a fixed constant — never user-visible (§4).
 *
 * `source` selects where the value comes from (default `url_param`, preserving
 * legacy behavior). `paramName` names the URL/cookie key it reads. `fallback`
 * seeds the field when the source yields nothing — fixing the required-hidden
 * footgun (a required hidden with no captured value would otherwise always
 * fail). `constantValue` is the emitted string for the `constant` source. All
 * new keys are optional so existing forms stay valid, and each is a closed
 * enum / bounded string — nothing open-ended.
 *
 * Cross-key consistency (e.g. `constant` should carry a `constantValue`) is NOT
 * refined on this member: a discriminated-union member must stay a plain
 * `ZodObject`, and the union-level `superRefine` that would host it lives in the
 * registry (`form-schema.ts`), which is out of this field's edit scope. The
 * resolver treats a missing companion as "nothing resolved → fallback", and the
 * server derives `constant`/`timestamp` authoritatively, so a malformed config
 * degrades safely rather than mis-submitting.
 */
export const hiddenFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('hidden'),
  // Required for backward-compat (existing forms + the machine-safe key the
  // admin defaults to the field key). Only read by url_param/cookie sources.
  paramName: z
    .string()
    .min(1, { message: 'paramName is required' })
    .max(64, { message: 'paramName must be at most 64 characters' }),
  // Optional (not `.default`): a zod default would make `source` required in the
  // inferred output type and force every hidden-field literal in the admin to
  // set it. Absent ⇒ `url_param` is applied at runtime by the resolver/server.
  source: z.enum(HIDDEN_SOURCES).optional(),
  constantValue: z.string().max(HIDDEN_MAX_VALUE_LENGTH).optional(),
  fallback: z.string().max(HIDDEN_MAX_VALUE_LENGTH).optional(),
});
