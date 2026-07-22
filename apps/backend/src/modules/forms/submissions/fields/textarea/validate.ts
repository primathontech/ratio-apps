import { FORM_TEXTAREA_DEFAULT_MAX_LENGTH } from '@ratio-app/shared/schemas/form-schema';
import type { FieldOfType, ServerValidateResult } from '../types';

export function validateTextarea(
  field: FieldOfType<'textarea'>,
  value: unknown,
): ServerValidateResult {
  if (typeof value !== 'string') return { error: 'must be a string' };
  const v = field.validation;
  const maxLength = v?.maxLength ?? FORM_TEXTAREA_DEFAULT_MAX_LENGTH;
  if (v?.minLength !== undefined && value.length < v.minLength) {
    return { error: `must be at least ${v.minLength} characters` };
  }
  if (value.length > maxLength) {
    return { error: `must be at most ${maxLength} characters` };
  }
  return { value };
}
