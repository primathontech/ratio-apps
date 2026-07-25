import { optionValues } from '@ratio-app/shared/schemas/fields/_shared/base';
import type { FieldOfType, ServerValidateResult } from '../types';

export function validateMultiSelect(
  field: FieldOfType<'multi_select'>,
  value: unknown,
): ServerValidateResult {
  const allowed = new Set(optionValues(field.options));
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && allowed.has(v))) {
    return { error: 'Please choose only from the available options.' };
  }
  // Cap the array at the number of defined options and reject duplicates (P2-6):
  // without this a 2-option field accepts thousands of repeated valid values,
  // bloating data_json / CSV / webhook payloads (bounded only by the body limit).
  if (value.length > field.options.length) {
    return { error: 'Please make fewer selections.' };
  }
  if (new Set(value).size !== value.length) {
    return { error: 'Please remove duplicate selections.' };
  }
  // Server-authoritative selection-count bounds (P0 field-depth): the client
  // "N of M" check is a UX mirror only — the public submit path can bypass it,
  // so min/max are re-enforced here from the persisted schema.
  const min = field.selection?.min;
  const max = field.selection?.max;
  if (min !== undefined && value.length < min) {
    return { error: `Please select at least ${min} option${min === 1 ? '' : 's'}.` };
  }
  if (max !== undefined && value.length > max) {
    return { error: `Please select at most ${max} option${max === 1 ? '' : 's'}.` };
  }
  return { value };
}
