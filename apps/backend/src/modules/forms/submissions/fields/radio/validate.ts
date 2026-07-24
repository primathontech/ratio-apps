import type { FieldOfType, ServerValidateResult } from '../types';

export function validateRadio(field: FieldOfType<'radio'>, value: unknown): ServerValidateResult {
  if (typeof value !== 'string' || !field.options.includes(value)) {
    return { error: 'Please choose one of the available options.' };
  }
  return { value };
}
