import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

export function validateRadio(
  field: ControlFieldOf<'radio'>,
  ctx: FieldValidateCtx,
): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'This field is required.' : null;
  return field.options.includes(String(value))
    ? null
    : 'Please choose one of the available options.';
}
