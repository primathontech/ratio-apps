import {
  EMAIL_MAX_LENGTH_DEFAULT,
  EMAIL_RE,
  emailDomain,
  isFreeEmailProvider,
  matchesDomain,
  normalizeEmail,
} from '@ratio-app/shared/schemas/fields/email/constants';
import type { FieldOfType, ServerValidateResult } from '../types';

/**
 * Server-authoritative email validation. Normalizes to the canonical form
 * (trim + lowercase) and RETURNS it via `{ value }`, so the stored/exported
 * value is always canonical regardless of what the client sent. Every rule
 * (length, format, free-provider block, domain allow/block) is enforced here
 * even when the SDK mirror was bypassed. The shared constants are the single
 * source of truth for both sides.
 */
export function validateEmail(field: FieldOfType<'email'>, value: unknown): ServerValidateResult {
  if (typeof value !== 'string') return { error: 'Please enter a valid email address.' };

  const normalized = normalizeEmail(value);
  const v = field.validation;
  const maxLength = v?.maxLength ?? EMAIL_MAX_LENGTH_DEFAULT;

  if (normalized.length > maxLength) {
    return { error: `Please enter an email address up to ${maxLength} characters.` };
  }
  if (!EMAIL_RE.test(normalized)) {
    return { error: 'Please enter a valid email address.' };
  }

  const domain = emailDomain(normalized);
  if (v?.blockFreeProviders && isFreeEmailProvider(normalized)) {
    return { error: 'Please use a business email address.' };
  }
  if (
    v?.allowedDomains &&
    v.allowedDomains.length > 0 &&
    !matchesDomain(domain, v.allowedDomains)
  ) {
    return { error: 'Please use an email from an allowed domain.' };
  }
  if (v?.blockedDomains && v.blockedDomains.length > 0 && matchesDomain(domain, v.blockedDomains)) {
    return { error: 'Emails from this domain are not accepted.' };
  }

  return { value: normalized };
}
