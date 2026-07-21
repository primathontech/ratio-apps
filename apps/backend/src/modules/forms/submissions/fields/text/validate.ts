import type { FieldOfType, ServerValidateResult } from '../types';

export function validateText(field: FieldOfType<'text'>, value: unknown): ServerValidateResult {
  if (typeof value !== 'string') return { error: 'must be a string' };
  const v = field.validation;
  if (v?.minLength !== undefined && value.length < v.minLength) {
    return { error: `must be at least ${v.minLength} characters` };
  }
  if (v?.maxLength !== undefined && value.length > v.maxLength) {
    return { error: `must be at most ${v.maxLength} characters` };
  }
  if (v?.pattern !== undefined && !new RegExp(v.pattern).test(value)) {
    return { error: 'does not match the required pattern' };
  }
  return { value };
}
