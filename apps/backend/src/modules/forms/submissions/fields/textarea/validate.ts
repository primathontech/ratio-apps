import { FORM_TEXTAREA_DEFAULT_MAX_LENGTH } from '@ratio-app/shared/schemas/form-schema';
import type { FieldOfType, ServerValidateResult } from '../types';

export function validateTextarea(
  field: FieldOfType<'textarea'>,
  value: unknown,
): ServerValidateResult {
  if (typeof value !== 'string') return { error: 'Please enter a valid value.' };
  const v = field.validation;
  const maxLength = v?.maxLength ?? FORM_TEXTAREA_DEFAULT_MAX_LENGTH;
  if (v?.minLength !== undefined && value.length < v.minLength) {
    return { error: `Please enter at least ${v.minLength} characters.` };
  }
  if (value.length > maxLength) {
    return { error: `Please enter no more than ${maxLength} characters.` };
  }
  return { value };
}
