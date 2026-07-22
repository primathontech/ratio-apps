import type { FieldOfType, ServerValidateResult } from '../types';

/** +91 10-digit phone (PRD v1): '+919876543210' or '9876543210'. */
const PHONE_RE = /^(\+91)?[0-9]{10}$/;

export function validatePhone(_field: FieldOfType<'phone'>, value: unknown): ServerValidateResult {
  if (typeof value !== 'string') return { error: 'Please enter a valid 10-digit phone number.' };
  const compact = value.replace(/[\s-]/g, '');
  if (!PHONE_RE.test(compact)) {
    return { error: 'Please enter a valid 10-digit phone number.' };
  }
  // Normalize to +91XXXXXXXXXX.
  return { value: `+91${compact.slice(-10)}` };
}
