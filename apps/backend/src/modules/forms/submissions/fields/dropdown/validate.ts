import type { FieldOfType, ServerValidateResult } from '../types';

export function validateDropdown(
  field: FieldOfType<'dropdown'>,
  value: unknown,
): ServerValidateResult {
  if (typeof value !== 'string' || !field.options.includes(value)) {
    return { error: 'must be one of the configured options' };
  }
  return { value };
}
