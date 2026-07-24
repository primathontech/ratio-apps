import type { FieldOfType, ServerValidateResult } from '../types';

/** Simple, deliberately-strict email shape (client mirrors it in the SDK). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(_field: FieldOfType<'email'>, value: unknown): ServerValidateResult {
  if (typeof value !== 'string' || !EMAIL_RE.test(value)) {
    return { error: 'Please enter a valid email address.' };
  }
  return { value };
}
