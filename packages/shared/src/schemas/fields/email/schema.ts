import { z } from 'zod';
import { baseFieldShape } from '../_shared/base';
import {
  EMAIL_DOMAIN_RE,
  EMAIL_MAX_DOMAIN_LIST,
  EMAIL_MAX_LENGTH_CEILING,
  EMAIL_MAX_LENGTH_DEFAULT,
} from './constants';

/**
 * A bare-hostname allow/block entry — no scheme, no path, no `@`. Bounded
 * string + curated regex (see constants); the array is capped so neither the
 * schema nor the server-side membership check is ever unbounded.
 */
const emailDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(EMAIL_DOMAIN_RE, { message: 'must be a bare domain like example.com' });

const emailDomainListSchema = z.array(emailDomainSchema).max(EMAIL_MAX_DOMAIN_LIST);

/**
 * email: all optional so existing forms stay valid with no `validation` object.
 * Server-authoritative behavior (normalize, length cap, free-provider block,
 * domain membership) lives in the backend validator; the SDK mirrors it and the
 * "did you mean" hint is client-only. `allowedDomains`/`blockedDomains` are
 * mutually exclusive (a self-refine keeps the discriminated-union member a
 * plain object — the refine hangs off this nested schema, not the field).
 */
const emailValidationSchema = z
  .object({
    // Default 254 (RFC-5321); hard-capped at 320 so the value can never grow
    // unbounded. The server treats an unset value as the default regardless.
    maxLength: z
      .number()
      .int()
      .min(1)
      .max(EMAIL_MAX_LENGTH_CEILING)
      .default(EMAIL_MAX_LENGTH_DEFAULT),
    // Client-only typo hint (non-blocking). Default on.
    suggestCorrections: z.boolean().default(true),
    // Server-enforced: reject curated free/consumer mailbox providers.
    blockFreeProviders: z.boolean().default(false),
    // Mutually-exclusive domain lists (server-enforced membership).
    allowedDomains: emailDomainListSchema.optional(),
    blockedDomains: emailDomainListSchema.optional(),
  })
  .refine(
    (v) =>
      !(
        v.allowedDomains &&
        v.allowedDomains.length > 0 &&
        v.blockedDomains &&
        v.blockedDomains.length > 0
      ),
    { message: 'set either an allowed-domains list or a blocked-domains list, not both' },
  );

export const emailFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('email'),
  validation: emailValidationSchema.optional(),
});
