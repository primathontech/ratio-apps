import { optionValues } from '@ratio-app/shared/schemas/fields/_shared/base';
import { isValidOtherValue } from '@ratio-app/shared/schemas/fields/_shared/select-constants';
import type { FieldOfType, ServerValidateResult } from '../types';

export function validateDropdown(
  field: FieldOfType<'dropdown'>,
  value: unknown,
): ServerValidateResult {
  if (typeof value !== 'string') {
    return { error: 'Please choose one of the available options.' };
  }
  if (optionValues(field.options).includes(value)) return { value };
  // Server-authoritative "Other" (§4.5 P0): when allowOther, accept a bounded non-empty value outside the option set. Mirrors the SDK.
  if (field.allowOther && isValidOtherValue(value)) return { value };
  return { error: 'Please choose one of the available options.' };
}
