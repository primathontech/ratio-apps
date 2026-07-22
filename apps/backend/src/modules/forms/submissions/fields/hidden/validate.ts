import type { FieldOfType, ServerValidateResult } from '../types';

/** Cheap DoS guard on a captured hidden value (UTM etc, §4) — never user-typed. */
const HIDDEN_MAX_LENGTH = 2048;

export function validateHidden(
  _field: FieldOfType<'hidden'>,
  value: unknown,
): ServerValidateResult {
  // Captured from URLSearchParams client-side — accept the string, bound it.
  if (typeof value !== 'string') return { error: 'must be a string' };
  if (value.length > HIDDEN_MAX_LENGTH) {
    return { error: `must be at most ${HIDDEN_MAX_LENGTH} characters` };
  }
  return { value };
}
