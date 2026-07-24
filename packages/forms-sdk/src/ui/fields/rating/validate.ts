import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

export function validateRating(
  field: ControlFieldOf<'rating'>,
  ctx: FieldValidateCtx,
): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'This field is required.' : null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= field.max
    ? null
    : `Please choose a rating between 1 and ${field.max}.`;
}
