import type { FieldOfType, ServerValidateResult } from '../types';

/** +91 10-digit phone (PRD v1): '+919876543210' or '9876543210'. */
const PHONE_RE = /^(\+91)?[0-9]{10}$/;

export function validatePhone(_field: FieldOfType<'phone'>, value: unknown): ServerValidateResult {
  if (typeof value !== 'string') return { error: 'must be a string' };
  const compact = value.replace(/[\s-]/g, '');
  if (!PHONE_RE.test(compact)) {
    return { error: 'must be a 10-digit Indian phone number (+91 optional)' };
  }
  // Normalize to +91XXXXXXXXXX.
  return { value: `+91${compact.slice(-10)}` };
}
