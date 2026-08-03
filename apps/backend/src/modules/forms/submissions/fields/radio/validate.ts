import { optionValues } from '@ratio-app/shared/schemas/fields/_shared/base';
import { isValidOtherValue } from '@ratio-app/shared/schemas/fields/_shared/select-constants';
import type { FieldOfType, ServerValidateResult } from '../types';

export function validateRadio(field: FieldOfType<'radio'>, value: unknown): ServerValidateResult {
  if (typeof value !== 'string') {
    return { error: 'Please choose one of the available options.' };
  }
  if (optionValues(field.options).includes(value)) return { value };
  // Server-authoritative "Other" (§4.9 P0): when allowOther, accept a bounded,
  // non-empty value outside the option set — the typed free text. Mirrors the
  // SDK validator exactly so client and server verdicts can't drift.
  if (field.allowOther && isValidOtherValue(value)) return { value };
  return { error: 'Please choose one of the available options.' };
}
