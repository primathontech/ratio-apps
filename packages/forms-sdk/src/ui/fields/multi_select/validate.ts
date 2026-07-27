import { isValidOtherValue } from '@ratio-app/shared/schemas/fields/_shared/select-constants';
import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

export function validateMultiSelect(
  field: ControlFieldOf<'multi_select'>,
  ctx: FieldValidateCtx,
): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'This field is required.' : null;
  const list = Array.isArray(value) ? value : [];
  const allowed = new Set(field.options.map((o) => o.value));
  const nonMembers = list.filter((v) => !allowed.has(String(v)));
  if (field.allowOther) {
    // "Other" parity with the server: at most one bounded, non-empty value
    // outside the option set (the typed "Other" text).
    if (nonMembers.length > 1 || nonMembers.some((v) => !isValidOtherValue(v))) {
      return 'Please choose only from the available options.';
    }
  } else if (nonMembers.length > 0) {
    return 'Please choose only from the available options.';
  }
  // Selection-count bounds — UX mirror of the server-authoritative check.
  const min = field.selection?.min;
  const max = field.selection?.max;
  if (min !== undefined && list.length < min) {
    return `Please select at least ${min} option${min === 1 ? '' : 's'}.`;
  }
  if (max !== undefined && list.length > max) {
    return `Please select at most ${max} option${max === 1 ? '' : 's'}.`;
  }
  return null;
}
