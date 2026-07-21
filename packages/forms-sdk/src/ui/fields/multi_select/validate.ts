import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

export function validateMultiSelect(
  field: ControlFieldOf<'multi_select'>,
  ctx: FieldValidateCtx,
): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'this field is required' : null;
  const list = Array.isArray(value) ? value : [];
  return list.every((v) => field.options.includes(String(v)))
    ? null
    : 'every selection must be one of the configured options';
}
