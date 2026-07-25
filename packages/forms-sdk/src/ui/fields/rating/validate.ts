import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

export function validateRating(
  field: ControlFieldOf<'rating'>,
  ctx: FieldValidateCtx,
): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'This field is required.' : null;
  const n = Number(value);
  // min absent ⇒ 1 (1-based); 0 enables a 0-based scale (e.g. 0–10 NPS).
  const min = field.min ?? 1;
  return Number.isInteger(n) && n >= min && n <= field.max
    ? null
    : `Please choose a rating between ${min} and ${field.max}.`;
}
