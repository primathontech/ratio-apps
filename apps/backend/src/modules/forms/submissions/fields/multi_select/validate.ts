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
  // Cap the array at the number of defined options and reject duplicates (P2-6):
  // without this a 2-option field accepts thousands of repeated valid values,
  // bloating data_json / CSV / webhook payloads (bounded only by the body limit).
  if (value.length > field.options.length) {
    return { error: 'too many selections' };
  }
  if (new Set(value).size !== value.length) {
    return { error: 'selections must not contain duplicates' };
  }
  return { value };
}
