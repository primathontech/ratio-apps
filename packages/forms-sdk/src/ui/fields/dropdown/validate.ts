import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

export function validateDropdown(
  field: ControlFieldOf<'dropdown'>,
  ctx: FieldValidateCtx,
): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'this field is required' : null;
  return field.options.includes(String(value)) ? null : 'must be one of the configured options';
}
