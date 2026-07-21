import type { FieldOfType, ServerValidateResult } from '../types';

export function validateMultiSelect(
  field: FieldOfType<'multi_select'>,
  value: unknown,
): ServerValidateResult {
  if (
    !Array.isArray(value) ||
    !value.every((v) => typeof v === 'string' && field.options.includes(v))
  ) {
    return { error: 'every selection must be one of the configured options' };
  }
  return { value };
}
