import {
  EMAIL_MAX_LENGTH_DEFAULT,
  EMAIL_RE,
  emailDomain,
  isFreeEmailProvider,
  matchesDomain,
  normalizeEmail,
} from '@ratio-app/shared/schemas/fields/email/constants';
import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

/**
 * Client-side pre-validation mirror. The backend validator is authoritative and
 * re-runs every check on the normalized value; this exists only for fast UX.
 */
export function validateEmail(
  field: ControlFieldOf<'email'>,
  ctx: FieldValidateCtx,
): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'This field is required.' : null;

  const normalized = normalizeEmail(String(value));
  const v = field.validation;
  const maxLength = v?.maxLength ?? EMAIL_MAX_LENGTH_DEFAULT;

  if (normalized.length > maxLength) {
    return `Please enter an email address up to ${maxLength} characters.`;
  }
  if (!EMAIL_RE.test(normalized)) return 'Please enter a valid email address.';

  const domain = emailDomain(normalized);
  if (v?.blockFreeProviders && isFreeEmailProvider(normalized)) {
    return 'Please use a business email address.';
  }
  if (
    v?.allowedDomains &&
    v.allowedDomains.length > 0 &&
    !matchesDomain(domain, v.allowedDomains)
  ) {
    return 'Please use an email from an allowed domain.';
  }
  if (v?.blockedDomains && v.blockedDomains.length > 0 && matchesDomain(domain, v.blockedDomains)) {
    return 'Emails from this domain are not accepted.';
  }
  return null;
}
