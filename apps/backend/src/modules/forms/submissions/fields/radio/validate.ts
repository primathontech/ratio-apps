import type { FieldOfType, ServerValidateResult } from '../types';

export function validateRadio(field: FieldOfType<'radio'>, value: unknown): ServerValidateResult {
  if (typeof value !== 'string' || !field.options.includes(value)) {
    return { error: 'must be one of the configured options' };
  }
  return { value };
}
