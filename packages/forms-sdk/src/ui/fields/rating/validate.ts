import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

export function validateRating(
  field: ControlFieldOf<'rating'>,
  ctx: FieldValidateCtx,
): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'this field is required' : null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= field.max
    ? null
    : `must be a rating from 1 to ${field.max}`;
}
