import { isValidOtherValue } from '@ratio-app/shared/schemas/fields/_shared/select-constants';
import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

export function validateRadio(
  field: ControlFieldOf<'radio'>,
  ctx: FieldValidateCtx,
): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'This field is required.' : null;
  const str = String(value);
  if (field.options.some((o) => o.value === str)) return null;
  // "Other" free-text parity with the server: when allowOther, a bounded,
  // non-empty value outside the option set is accepted (the typed text).
  if (field.allowOther && isValidOtherValue(str)) return null;
  return 'Please choose one of the available options.';
}
