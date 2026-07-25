import { optionValues } from '@ratio-app/shared/schemas/fields/_shared/base';
import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

export function validateMultiSelect(
  field: ControlFieldOf<'multi_select'>,
  ctx: FieldValidateCtx,
): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'This field is required.' : null;
  const list = Array.isArray(value) ? value : [];
  const allowed = new Set(optionValues(field.options));
  return list.every((v) => allowed.has(String(v)))
    ? null
    : 'Please choose only from the available options.';
}
